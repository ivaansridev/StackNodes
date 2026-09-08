# Monday, 8 June 2026
- [x] implement this big feature: node types. for now only implement text, file/image and thats it when you right click on a node add option convert to... and if its being converted into a image, it should show drag n drop or click to open file manager. You should be able to resize the image and if the image is selected and you click on it it opens it into fullscreen with button download and replace also. When pressing enter to create new node, the default type is text
- [x] When copying from right click menu, it is copied to the system clipboard
- [x] In the right-click menu make the options:
  1. delete
  2. indent
  3. unindent
  4. collapse/expand
  5. toggle complete
  6. copy
  7. paste under [ctrl + v]
  8. paste above [alt + v]
  9. select node
  And when using copy, plese refer to the TODO above
- [x] Add a new feature: Right-click menu: you can right-click on any node to on mobile add a triple dot icon on the touch bar right now only make optiones TEST

# Before 8 June 2026
- [x] Add a button Called 'Sync' with a good icon see sync.js
- [x] When clicking sync it should open a popup where there are two fields, one is Room, the other secret and make a new file called sync.js and in that file use GUN.js to make a sync system with two button Push and pull. When clicking push, it should push the entire JSON into the room (secret is for encrypted which is required) and pull pulls the JSON and creates a new node called "{SYNC}" with the sync pulled.
- [x] Add MD SUpport for **bold** *italic* ~~strikethrough~~ and `code snippet` with thier exports also working
- [x] Touch bar update: New icon: Toggle line numbers
- [x] Align export: MD: replace - to 1. for numbering, for txt same, for json use your own
- [x] Fix manifest.json
- [x] Add keyboard shortcut Ctrl + J to collapse / expand current node
- [x] Make new feature To make all dots inside a node to be numbered you should be able to toggle the numbers by Ctrl + E and also only apply the number to the children of the highlighted node and if no children toast "No children to number"
- [x] For ultra-large notes in stacknodes either add lazy-loading or do anything so the browser dosen't eat memory
- [x] In settings add option: no keyboard mode the dropdown options are auto (auto-detects), yes, no: if yes selected then show a small bar at the bottom of the screen. Buttons include Undo/Redo, Indent/Unindent Focus in/Focus Out. needed for mobile
- [x] Add new options in triple-dot-menu: Collapse all & Expand all
- [x] In Global search if pressing Tab, it should highlight the first entry and Shift+Tab to the upper/last and if clicked and enter pressed, it should highlight the entry and focus its parent not create a new node
- [x] ==BUG== Ctrl + X dosen't work
- [x] Add import for TXT, JSON and MD with two options asked to the user: Replace root node (Has a 5 Second wait) and Append to an existing node and lets the user choose the node
- [x] Add Global search entry to triple dot menu
- [x] Fix pasting multiple lines: if multiple lines are pasted, siblings should be created
- [x] ==BUG== When pressing enter on a node which has children, the node it gets added after all the children, make it, make it if pressing enter on a parent, a new child of that parent is to be created
- [x] ==BUG== Version history showing wrong number of nodes in previous numbers
- [x] Change favicon to assets/icon.svg
- [x] After deleting a node, the cursor should move at the end of the upper node text
- [x] ==BUG== When deleting a parent which has less child nodes but the child nodes also have nested nodes which add up to more than 5, the modal dosent show up
- [x] ==BUG== When using backspace to delete node, cursor teleports not to the upper node but at the parent. Fix
- [x] ==BUG== Ctrl + Shift + Backspace should also delete the node not just remove the text
- [x] If deleting a parent which has more than 5 nodes, ask for a warning, the modal keyboard shortcuts: y/enter/delete: delete, n/backspace: close modal and not delete parent 
- [x] Add a close button just like in settings to the cheat sheet
- [x] Revert the toggle size
- [x] Settings should open a modal, move all export to settings
- [x] Make the tittle centered in the top bar
- [x] Move Hide completed onto triple dot menu
- [x] In triple dot menu make settings button with icon
- [x] ==VBUG== Make it when theres a lot of content for the top bar, add ... to the start and short it from the start
- [x] ==BUG== When directly focusing a node which has a parent, the parent is not shown in the top bar (If using keyboard shortcuts) i suggest a single function that runs on the keyboard shortcuts and button press that opens the focus view
- [x] Clicking on the node bullet focuses it to the focus that happens on Ctrl + ]
- [x] Make the font bigger
- [x] ==BUG== Clicking on the text in any node does not move the cursor to there, it moves it to the start of the node 
- [x] Move export to triple dot menu
- [x] Add styling for checkboxes
- [x] Fix indentation
