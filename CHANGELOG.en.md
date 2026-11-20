[Bahasa Indonesia](CHANGELOG.md) · **English**

# Changelog

All notable changes to kantor-rpg, newest first. Each release goes to the [public demo](https://employee-rpg.air-buddy.site) after the tests and CI pass. The release code is the commit on `main`.

## v2.7.3, 20 November 2026

- Arena Bom: a wider board (19 x 11 tiles, was 15 x 13) that fills a TV, with tiles about 17% bigger. Rounds won show on each player's card.
- 17 August Games: the button list under the game shows only the buttons of the event being played.

## v2.7.2, 20 November 2026

**Clearer multiplayer, Arena Bom with 4 players fixed**

- Arena Bom: Players 2 to 4 are no longer also moved by the computer. Before, the player's pad and the computer both steered the same character, so it walked and dropped bombs by itself.
- Arena Bom: start corners go clockwise in the order of the top cards (P1 top left, P2 top right, P3 bottom right, P4 bottom left), also written on the intro screen.
- Every multiplayer game (Arena Bom, Table Football, Cable Snake, Flash Technician, 17 August Games, Table Hockey): player characters wear their player colour (red, blue, green, yellow), with a coloured P1 to P4 tag over the head and a colour ring at the feet.
- Player colours are a little darker so white text on them is readable.
- 17 August Games: each lane name sits on a light label (it was green text on grass).
- Table Hockey: the centre line is neutral, no longer red like Player 1.

## v2.7.1, 19 November 2026 (release `d488398`)

**Easier phone controller**

- Always landscape: an upright phone shows the pad already turned, just tilt the phone left. On Android the first touch goes full screen and locks landscape.
- No zoom: pinch, double tap and drag no longer zoom the page on iPhone.
- A DualSense layout that fits every phone: L1 over the D-pad and left stick, R1 over the action buttons and right stick, Create and Options in the middle.
- New right stick, for fine billiards aim and spin.
- The left stick follows the thumb: touch anywhere in the left area and the stick appears there.
- Android phones give a short buzz on each press.

## v2.4 to v2.7, 19 November 2026 (release `da54a01`)

**Game list, two-player billiards, phones as pads, 5 new multiplayer games**

- Game list (Games button in the HUD, key G): all 20 games in the office in two tabs, Multiplayer and Single player, with players, room and floor. Play takes the avatar to that room and opens the game, including Floor 1 games from Floor 2.
- Game Station: 10 cabinets, all playable. Multiplayer on top, single player below, player count on each cabinet.
- Billiards:
  - Right stick aim is half the v2.3 speed. Hold L2: 8 times finer.
  - Settings > Controller has a Stick aim speed slider (25% to 200%).
  - The red spin dot goes anywhere on the cue ball: hold Triangle and move the right stick (keyboard: hold C and the arrows, mouse: click on the ball picture). Tap Triangle to centre it.
  - Side spin bends the cue ball off the cushion.
  - Two players take turns: a second pad or phone, or tick "Take turns on one device".
  - 8-ball rules: legal break, foul for hitting the rival's ball first, foul without a cushion, ball in hand anywhere after a foul, the 8-ball pocket is marked automatically.
  - Impact sounds follow how hard the balls hit.
- Play with a phone: the screen shows a QR code that opens a pad on the phone. Phones are Players 2 to 5, no app to install. Direct link (WebRTC) on the same network, through the server otherwise. A guest WiFi QR shows when an SSID and password are saved in that panel; the password stays on that PC only.
- 5 new multiplayer games in the Game Station:
  - Table Football: 2 against 2 futsal, 1 to 4 players.
  - Cable Snake: pull a fibre cable, do not crash, 1 to 4 players.
  - Flash Technician: co-op, fix customer outages before the SLA runs out, 1 to 4 players.
  - 17 August Games: sack race, cracker eating, tug of war, 1 to 4 players.
  - Table Hockey: air hockey, one against one.
- Numbers in the games use lining figures (0 no longer looks like the letter o).
- Agent chat: an open Search messages box no longer closes by itself when a new reply arrives.
- 9 of the 20 games are now multiplayer.

## v2.3, 19 November 2026

**DualSense friendly**

- As soon as a gamepad connects or is pressed, every button hint on screen uses that pad's buttons. DualSense and DualShock get PlayStation shapes (Cross, Circle, Square, Triangle, L1/R1, L2/R2, Options, Create); other pads get A/B/X/Y. Use the keyboard, mouse or touch screen again and the hints follow.
- Office: a pad legend at the bottom right (walk, camera, interact, back, run, zoom, map, settings), action prompts like "Cross Greet", the on-screen joystick hidden, and the Controls dialog lists the pad buttons. The Reversed and Left-handed profiles are reflected.
- Billiards on a pad:
  - Left stick points the aim, right stick turns it finely (a small push moves very slowly, more tilt turns faster).
  - Hold L2 for precise aim, four times slower.
  - Pull R2 for power, deeper is harder, release to shoot. A pull that is too soft is cancelled, Circle cancels a pull.
  - Short rumble on a shot and when a ball drops (Chrome and Edge; off with Reduce motion).
  - The Relaxed profile turns the aim slower.
- All 15 mini games: the intro card has a short 2 to 3 step tutorial and a button list for keyboard, gamepad and touch screen. While playing, a button legend sits under the game. Hints inside the game (for example "Cross: LIFT!") follow the device in use.

## v2.2, 14 October 2026

**Play together with several gamepads (local multiplayer)**

- Three mini games can be played together on one screen, for example on the office TV with several gamepads:
  - **Office Brawl:** Player 1 against Player 2. Each picks a fighter, then one match, first to 2 rounds.
  - **Bomb Arena:** up to 4 players. Empty corners go to the computer, and the last one standing wins the round.
  - **Office Chess:** Player 1 is white, Player 2 is black, taking turns on the same board.
- To join: on the game's opening card, connect another gamepad and press **A**. The player list grows at once. Press **B** on that pad to leave.
- Player 1 can still use the keyboard, touch screen, or the first gamepad. Every player has their own press queue, so no press gets lost.
- A two-player result names the winner and is not added to the leaderboard.
- With only one gamepad connected, the game runs as before against the computer.

**Fixes**

- The gamepad A that presses **Start** no longer reaches the game too. Before, in Office Brawl that press picked a fighter before you could choose.

## v2.1.1, 14 October 2026 (release `84a8678`)

**Gym animations**

- Characters on a treadmill now run on the belt, facing its console. Before, they stood on the floor between the two treadmills.
- Characters on the exercise bike now sit on the saddle, pedal, and hold the handlebar. Before, they just stood next to the bike.
- The exercise bike model was rebuilt in Blender to fit the characters: a 0.45 m saddle (the seat height of the character animations), pedals right under the feet, and the handlebar at hand height. The old model was too tall, so the feet could not reach the pedals.

## v2.1, 13 October 2026 (release `5049ff0`)

**Chess moved to the table**

- **Office Chess** is played at the board game table in the Game room, floor 2, instead of slot 6 of the Game Station. An 8x8 chessboard sits on the table.
- Chess opens from the table or any of its four stools. The avatar takes the nearest free stool, and while you play, NPCs see that stool as taken.
- Full chess rules (castling, en passant, promotion, checkmate, draws) against a teammate at three difficulty levels.
- Game Station slot 6 is empty again. There are now 15 mini games: 10 at office facilities and 5 in the Game Station.

**More responsive mini game buttons**

- On 120 Hz screens (iPhone Pro, iPad Pro, Mac ProMotion) quick presses used to get lost. In a 30-press test v2.0 received 0; v2.1 receives 30, on 144 Hz screens too.
- Every press is now queued and handed to the game one at a time, so two quick presses still count as two.
- One press opens one layer. A gamepad A or an Enter that is still held no longer picks a Game Station slot or presses **Start** right away.
- Esc on the "Loading game..." screen closes the game.
- The Game Station follows the **Reversed buttons** controller profile.
- After a mini game closes, focus returns to the button that opened it, so keyboard and screen reader users keep their place.

**Mini game polish**

- Every game has a tutorial for the device in use (keyboard, gamepad, touch screen) with the right button names.
- Touch buttons on phones catch very short taps.
- Billiard physics rebuilt: balls slide, then roll, and backspin or topspin makes the cue ball stop, draw back, or follow through.
- The 3D reprimand is polished: a wind-up swing, a motion trail, a hit pause, cartoon words ("PLAK!", "TUK!", "POK!"), and a bouncing paper ball.
- New background music in a cozy game style: 12 original songs, 6 for office areas and 6 for mini games.

**HUD and phone layout**

- At 600 to 959 px wide (phones in landscape, small tablets) the top menu shows icons only. Before, Settings and Controls were cut off at the edge.
- The Controls dialog opens at the top instead of scrolled to the bottom.
- Notifications no longer cover the Action button, the Game Station, or mini game cards.
- The people list on the Map no longer changes while you touch it, so **Temui** (Meet) does not miss.

## v2.0, 13 October 2026 (release `18c7044`)

Requirements document: [PRD v2.0](PRD/PRD-v2.0.md).

- **14 mini games.** Nine office facilities open their own game: treadmill, dumbbell rack, mat, billiard table, coffee machine, server rack, drafting table, easel, and the library bookshelf.
- **Game Station.** The arcade cabinets and TV in the Game room open a 10-slot menu with 5 games: Drone Race, Office Brawl, Floor Hopper, Cable Link, and Bomb Arena.
- A game downloads only when opened, so the office stays light. Top 10 scores are kept in the browser.
- **Sound without audio files.** Footsteps, doors, the lift, and music per area are generated in the browser. Nearby effects get louder as you approach. Adjust in Settings > Sound, mute with **V**.
- **New animations.** 11 new clips: start walking, stop, turn, lift weights, cycle, draw, lay cable, fast typing, surprised, rub head, and flee. Walking and running blend smoothly with speed, the body leans into runs and turns, and characters glance at the CEO walking past.
- **Reprimand.** An NPC's profile card offers three ways to reprimand: a rolled paper swat, a toy hammer tap, or a thrown paper ball. Animation only; nothing is sent to the agent. NPCs whose agent is working cannot be reprimanded.

## v1.1, 11 to 13 October 2026

- **Map and minimap** (`ff2cd1e`): where every character is on each floor, other-floor badges, and **Temui** (Meet) across floors.
- **English** (`725a516`): two-language interface with a choice in Settings.
- **Phone HUD** (`e7d001a`): one row of menu icons; the menu and minimap fold away, and the choice is remembered.
- **Gamepad** (`1f6becc`): walking, camera, A/B/X/Y, LB/RB, Select, Start, and D-pad navigation in every menu.
- **Controller profiles** (`bedba72`): Standard, Left-handed, Relaxed, and Reversed buttons in Japanese style, with a pad diagram that lights up the pressed button.
- **Walk through NPCs** (`a7cb594`): keep pushing for 2 seconds, or run, and the avatar passes through an NPC in the way.
- **Agent chat** (`dd5b12b`): the Voice button works; `/new`, `/stop`, `/status`, `/telegram`, `/help` run on the server.
- **Solid walls** (`ac604d0`): the see-through wall effect is gone.
- **ICT riser removed** (`627f00d`): the avatar could get stuck in the shaft, so the area joined the store and service rooms. Rooms went from 38 to 36.
- Small fixes: the board refresh no longer clears the login form (`18258d0`), and dialog Close buttons moved to the footer (`ff6ef86`).

## v1.0 and earlier, 3 to 10 October 2026

- **Telegram-like chat** (`e480894`): typing indicator, ticks, push notifications, PWA, photos, files, and voice messages turned into text.
- **Echo and Leo personas** (`671accd2`): two new characters, 8 NPCs in total.
- **No more flickering windows** (`cad7bc4`).
- **v0.2** (`fa666c9a`): the two-floor 3D world, seeded NPCs, Office Studio, Avatar Studio, directory, work board, owner login with 2FA, and 15 working drawing sheets from one dataset.
