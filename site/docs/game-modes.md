# Game modes

You choose the mode in the lobby, on any seated phone.

## Companion

You play on the physical board with the physical cards. Each player's resources, production, played cards and
tags are kept on their phone. The global parameters and the standings are on the TV.

- Play a card by its printed number, by name, or with a photo.
- You see each change on your phone before you confirm it.
- Tile positions stay on the physical board, so the TV has the planet and the parameters, not the map.
- Start final scoring with **End the game and score it** in the game menu. Each player enters their board points.

Companion mode does not need the engine.

## Full game

The board is on the TV, and the cards and resources are on the phones. Every rule is applied by the open-source
Terraforming Mars engine. You need the engine container (it is part of the compose file).

Options in the lobby:

- **Draft**: pass research cards around the table each generation. On by default.
- **Fast mode**: every turn is two actions; you cannot end a turn after one. Passing still works.
- **Beginner Corporation** (per player): skip choosing a corporation and keep all ten starting cards for free.

## Both modes

- **Maps**: Tharsis, Hellas, Elysium, or Random (drawn when the game starts).
- **Prelude**: a table-wide switch. Each player keeps two of four preludes and plays both before the first round.
- **Corporate Era** cards are always in.
- **Turn clock**: Off, Relaxed (3 minutes a turn) or Brisk (90 seconds a turn). The clock is shown on the phones
  and the TV. Nothing happens when it runs out.
- **Smart hints** (per player, off by default): quiet notes about your own position, such as a milestone you can
  claim.
- **Mission control**: commentary on the TV, if [set up](optional-ai.md#mission-control).

## Solo

Start a game with one person. In a full game you play the engine's solo rules: a neutral player holds two
cities, the game runs to the end of generation 14 (12 with Prelude), and you win if Mars is terraformed by then.
You can also seat [bots](bots.md) and play against them.
