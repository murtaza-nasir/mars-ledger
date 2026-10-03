# Bots

Bots fill seats in full games only. Add them in the lobby with **Add a bot**: pick a name, a colour and a level. A
table holds up to five seats, bots included.

## Levels

| Level | How it plays |
|---|---|
| **Easy** | Plays loosely: random cards, random tiles, passes early. |
| **Normal** | Plays sensibly: buys and plays the cards that pay off, claims milestones, funds awards it leads, and keeps standard projects for the endgame. |
| **Hard (Jev)** | Normal's top moves, chosen by TypeSafe's Jev model from the board, the cards and the race. |

Hard (Jev) is offered only when the server has `TYPESAFE_API_KEY`. Each decision is a paid request. The spend
per game is capped by `BOT_JEV_BUDGET_USD` (default 0.10 US dollars); after that, the seat plays as Normal. The
board, the cards and the game state are sent to TypeSafe for each decision.

## Bot speed

The game menu holds a table-wide **Bot speed**:

- **Quick**: bots move within a few seconds.
- **Table pace** (default): about as long as a person, 6 to 15 seconds a turn, longer later in the game.
- **Slow**: about half again as long as table pace.

With `BOT_DELAY_SCALE` you scale all bot pauses on the server. Set it to `0` for testing; the bots then move at once.

## Taking moves back

If only bots moved since your last move, you can tap **Undo** to take your move back together with theirs. The
bots then wait for your next move.

## Experimental judge

For research, you can set `BOT_JUDGE=jev`. Each Normal bot's move is then chosen by the Jev model from Normal's
options (or only for the bots named in `BOT_JUDGE_BOTS`). With the other `BOT_JUDGE_*` variables you tune the
context and the candidates. It needs `TYPESAFE_API_KEY` and is off by default.
