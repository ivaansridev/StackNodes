// STUN-first P2P Sync for StackNodes
// Uses PeerJS (MIT) for WebRTC with STUN NAT traversal
// Uses Web Crypto API for AES-GCM encryption
// No GUN.js or SEA.js dependency

const SYNC_CONFIG = {
  stunServers: [
    'stun:stun.l.google.com:19302',
    'stun:stun1.l.google.com:19302',
    'stun:stun2.l.google.com:19302',
    'stun:stun3.l.google.com:19302',
    'stun:stun4.l.google.com:19302',
    'stun:stun.l.twilio.com:3478',
    'stun:stun2.l.twilio.com:3478',
    'stun:stun.stunprotocol.org:3478',
    'stun:stun.framasoft.org:3478',
  ],
  timeouts: {
    libraryLoad: 5000,
    roomWait: 30000,
    connectionWait: 15000,
    sendAck: 3000,
  }
};

function roomToPeerId(room) {
  return 'jotdown-' + room.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
}

// Web Crypto API encryption (AES-GCM with PBKDF2 key derivation)
async function deriveKey(secret, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'PBKDF2' }, false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false, ['encrypt', 'decrypt']
  );
}

async function encryptData(data, secret) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(secret, salt);
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const combined = new Uint8Array(salt.length + iv.length + ciphertext.byteLength);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(ciphertext), salt.length + iv.length);
  return btoa(Array.from(combined, byte => String.fromCharCode(byte)).join(''));
}

async function decryptData(encoded, secret) {
  const raw = Uint8Array.from(atob(encoded), function (c) { return c.charCodeAt(0); });
  const salt = raw.slice(0, 16);
  const iv = raw.slice(16, 28);
  const ciphertext = raw.slice(28);
  const key = await deriveKey(secret, salt);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(decrypted));
}

var activePeer = null;
var connectedConns = new Set();

const SyncManager = {
  async init() {
    if (typeof Peer === 'undefined') {
      var start = Date.now();
      while (typeof Peer === 'undefined') {
        if (Date.now() - start > SYNC_CONFIG.timeouts.libraryLoad) {
          throw new Error('PeerJS library load timeout');
        }
        await new Promise(function (r) { return setTimeout(r, 50); });
      }
    }
  },

  cleanup() {
    if (activePeer) {
      try { activePeer.destroy(); } catch (e) { /* ignore */ }
      activePeer = null;
    }
    connectedConns.clear();
  },

  async pushToRoom(room, secret, data, onStatus) {
    onStatus = onStatus || function () {};
    onStatus('initialising');
    await this.init();
    onStatus('cleanup');
    this.cleanup();

    var peerId = roomToPeerId(room);

    return new Promise(function (resolve, reject) {
      var peer = new Peer(peerId, {
        config: { iceServers: [{ urls: SYNC_CONFIG.stunServers }] }
      });
      activePeer = peer;
      var settled = false;

      var timeout = setTimeout(function () {
        if (!settled) {
          settled = true;
          SyncManager.cleanup();
          reject(new Error('push timed out: no peer connected within ' + (SYNC_CONFIG.timeouts.roomWait / 1000) + 's'));
        }
      }, SYNC_CONFIG.timeouts.roomWait);

      peer.on('open', function (id) {
        onStatus('waiting');
        console.log('sync: room peer ready (' + id + '), waiting for puller...');
      });

      peer.on('connection', function (conn) {
        if (settled) return;
        clearTimeout(timeout);
        connectedConns.add(conn);

        conn.on('open', async function () {
          onStatus('pushing');
          console.log('sync: puller connected, sending data...');
          try {
            var encrypted = await encryptData(data, secret);
            conn.send(JSON.stringify({ type: 'jot-sync', data: encrypted }));

            var ackTimeout = setTimeout(function () {
              if (!settled) {
                settled = true;
                SyncManager.cleanup();
                resolve({ success: true, room: room, message: 'data pushed successfully', isP2P: true });
              }
            }, SYNC_CONFIG.timeouts.sendAck);

            conn.once('data', function (msg) {
              clearTimeout(ackTimeout);
              if (settled) return;
              try {
                var parsed = JSON.parse(msg);
                if (parsed.type === 'ack') {
                  settled = true;
                  SyncManager.cleanup();
                  resolve({ success: true, room: room, message: 'data pushed successfully', isP2P: true });
                }
              } catch (e) { /* ignore parse errors */ }
            });
          } catch (e) {
            if (!settled) {
              settled = true;
              SyncManager.cleanup();
              reject(new Error('encryption failed: ' + e.message));
            }
          }
        });

        conn.on('error', function (err) {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            SyncManager.cleanup();
            reject(new Error('connection error: ' + err.message));
          }
        });
      });

      peer.on('error', function (err) {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          SyncManager.cleanup();
          if (err.type === 'unavailable-id') {
            reject(new Error('room is already in use, try a different room name'));
          } else {
            reject(new Error('peerjs error: ' + err.message));
          }
        }
      });
    });
  },

  async pullFromRoom(room, secret, onStatus) {
    onStatus = onStatus || function () {};
    onStatus('initialising');
    await this.init();
    onStatus('waiting');
    this.cleanup();

    var roomPeerId = roomToPeerId(room);

    return new Promise(function (resolve, reject) {
      var peer = new Peer(undefined, {
        config: { iceServers: [{ urls: SYNC_CONFIG.stunServers }] }
      });
      activePeer = peer;
      var settled = false;

      var timeout = setTimeout(function () {
        if (!settled) {
          settled = true;
          SyncManager.cleanup();
          reject(new Error('pull timed out: room peer not available'));
        }
      }, SYNC_CONFIG.timeouts.roomWait);

      peer.on('open', function () {
        var conn = peer.connect(roomPeerId, { reliable: true });
        connectedConns.add(conn);

        var connTimeout = setTimeout(function () {
          if (!settled) {
            settled = true;
            SyncManager.cleanup();
            reject(new Error('connection to room peer failed'));
          }
        }, SYNC_CONFIG.timeouts.connectionWait);

        conn.on('open', function () {
          clearTimeout(connTimeout);
          if (settled) return;
          console.log('sync: connected to room, requesting data...');
          conn.send(JSON.stringify({ type: 'request' }));
        });

        conn.on('data', async function (msg) {
          if (settled) return;
          try {
            var parsed = JSON.parse(msg);
            if (parsed.type === 'jot-sync' && parsed.data) {
              settled = true;
              onStatus('pulling');
              clearTimeout(connTimeout);
              clearTimeout(timeout);
              var decrypted = await decryptData(parsed.data, secret);
              try { conn.send(JSON.stringify({ type: 'ack' })); } catch (e) { /* ignore */ }
              SyncManager.cleanup();
              resolve({
                success: true,
                room: room,
                data: decrypted,
                message: 'data pulled successfully',
                isP2P: true
              });
            }
          } catch (e) {
            if (!settled) {
              settled = true;
              clearTimeout(connTimeout);
              clearTimeout(timeout);
              SyncManager.cleanup();
              reject(new Error('decryption failed: ' + e.message));
            }
          }
        });

        conn.on('error', function (err) {
          if (!settled) {
            settled = true;
            clearTimeout(connTimeout);
            clearTimeout(timeout);
            SyncManager.cleanup();
            reject(new Error('connection error: ' + err.message));
          }
        });
      });

      peer.on('error', function (err) {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          SyncManager.cleanup();
          reject(new Error('peerjs error: ' + err.message));
        }
      });
    });
  },

  isConnected() {
    return connectedConns.size > 0;
  },

  getConnectedPeers() {
    return connectedConns.size;
  },

  getStatus() {
    if (connectedConns.size > 0) return 'connected (p2p)';
    return 'disconnected';
  },

  getConnectionInfo() {
    return {
      connected: connectedConns.size > 0,
      peersCount: connectedConns.size,
      peers: [],
      p2pConnections: connectedConns.size,
      relayConnections: 0,
      connectionTypes: {},
      reconnectAttempt: 0,
      status: this.getStatus()
    };
  },

  getConnectionMetrics() {
    return {
      totalConnections: connectedConns.size,
      p2pConnections: connectedConns.size,
      relayConnections: 0,
      p2pPercentage: connectedConns.size > 0 ? '100%' : 'N/A',
      stunServersAvailable: SYNC_CONFIG.stunServers.length,
      relayServersAvailable: 0,
      isUsingP2P: connectedConns.size > 0,
      usingRelay: false
    };
  }
};
