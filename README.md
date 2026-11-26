# Mow Town

A lawn-mowing life sim in one HTML file (`index.html`) with:

- 3 save slots and a beginner tutorial.
- Jobs, plus 🎯 Quests that reward cash, stickers and paint colours.
- 24 mowers in the Mower Shop (including 12 factory specials, $500–$6,000, each with its own paint job), Ray's Upgrade Stall and a Season Pass.
- Seasons that change every 7 in-game days.
- Online multiplayer: Co-op Town and Fastest Lawn Cut.

## Put it on GitHub Pages

1. Upload `index.html` to a GitHub repo.
2. In the repo, go to **Settings → Pages**, choose **Deploy from a branch**, pick `main` and `/ (root)`, then click **Save**.
3. After about a minute the game is live at `https://<your-username>.github.io/<repo-name>/`.

## Online multiplayer

Multiplayer runs on the **ZD Studios multiplayer server** (`https://mp.zdstudios.network`). The SDK is loaded from `https://mp.zdstudios.network/sdk.js`. The server address and public game key live in one place near the top of section 14 of `index.html`:

```js
const MP_CFG = { url: 'https://mp.zdstudios.network', key: 'pk_…', game: 'Mow Town' };
```

There's nothing else to host. If your server dashboard restricts allowed origins, add your GitHub Pages address (for example `https://<your-username>.github.io`).

**How to play online:** on the title screen, click **👥 Play Online**, pick which save's mower to bring, then choose one:

- **⚡ Quick Co-op / ⚡ Quick Race** to be matched with anyone waiting.
- **Host** to get a 6-character room code to give a friend.
- **Join by code**, or click **Join** on a room in the **Open rooms** list.

**Modes:**

- **🏡 Co-op Town:** single player, but 2 people in the host's town. Jobs are shared, and pay is split by how much each player mowed. The host's save is the town, so if the host leaves, the guest goes back to their own save.
- **🏁 Fastest Lawn Cut:** race side by side on two identical lawns. The host presses Start. If the host leaves, the other player becomes host.

## Towns, trucks and your worker

- **3 more towns** east along the highway: Oakridge (1.5× pay), Seaview Bay (2.1×) and Summit Hills (3×). Their lawns are much bigger, and you unlock their jobs by finishing 6, 15 and 30 jobs.
- **Mow Town Golf Club** sits on the highway between Mow Town and Oakridge (it needs a ride-on).
- **Your truck** is parked on Main Street outside home. Press E to drive (W/S, A/D). Drive a mower up to the back of the trailer and press E to load it; press E by the trailer to unload. Crashes, driving on lawns and running over gnomes cost money. Faster trucks and a double trailer are in Shop → Trucks & trailers.
- **Jake, your worker** (Crew button or C): hire him after 4 jobs, give him one of your spare mowers, and choose whether he mows the front or back lawn. He rides along in your truck and takes 20% of the pay for jobs he helps with. He only turns up while you have a job. He maps the lot first so he steers round fences, sheds, trees, flower beds, gnomes and your truck, mows straight stripes, and finishes with a clean-up and edge trim. His bumps never cost you money.
- **M** opens the big map. The boombox radio moved to **R**.
- **🏪 Mow Shop** (Main Street, next to the water tower): limited John Deere and Mow Master mowers, only sold there ($2,000 walk-behinds, $2,500 ride-ons), plus the **Limited Colour Pack** ($300): John Deere Green and Mow Master Orange, two paints you can't get anywhere else. The John Deere and Mow Master walk-behinds are the best push mowers in the game.
- **⛽ Petrol stations** in Oakridge, Seaview Bay and Summit Hills: pumps, plus a store inside that sells two accessories you can only get in that town.

## 🌍 Worlds

Press **O** (or the 🌍 Worlds button) to see the three worlds:

| World | To move there | Towns | Pay |
|---|---|---|---|
| 🏡 Mow Town Valley | (start) | Mow Town, Oakridge, Seaview Bay, Summit Hills | 1×–3× |
| 🌴 The Jungle | 60 lawns mowed + $25,000 moving fee | Vine Valley, Tiki Falls | 5×, 6.5× |
| 🌊 Deep Blue (underwater) | 150 lawns mowed + $150,000 moving fee | Coral Cove, Atlantis Heights | 10×, 13× |

- Each world has bigger lawns than the last, its own house (where you sleep), petrol stations, map and jobs.
- Each new world sells **12 mowers you can only buy there**:
  - **Jungle:** $8,000–$90,000.
  - **Underwater:** $25,000–$275,000.
  - They're priced against that world's pay, so the best ones take a while to save up for.
- Moving costs the fee once. After that, travelling between your worlds is free, and your money, mowers, truck and Jake come with you.
- The worlds sit far apart on the map (around x = 5,000 and x = 9,000), so you travel between them from the Worlds screen instead of driving.

## Accounts, backups and leaderboards

- New players pick a username on the sign-in screen and get a secret 10-character code (no password). Typing the code on any computer signs them in and brings back their saves. One account can be signed in on several devices at the same time.
- Accounts are run by `server-script.js` (since v1.15), so it must be installed for signing in to work. Accounts from v1.13–1.14 move over by themselves.
- The admin panel can kick and ban accounts (a ban also covers every device the account was played on).
- 👕 **Style** (next to Shop, or Y) has skin colour, hair colour, caps and tops.
- The code can be shown, hidden or copied in the account box on the home screen.
- Saves back up to the account on their own, and the newest copy of each slot wins. Saves already on a computer move into the first account made there, and any older copy that gets replaced is kept on that computer as a backup.
- 🏆 Leaderboards (Top earners, Most lawns, Fastest lawn cut) are on the home screen and the pause menu.
- **Play offline for now** still works. Offline saves stay on that computer until the player signs in.

`server-script.js` (pasted into the dashboard) runs the accounts, checks the admin password, and keeps the leaderboards and team scores honest. See **SETUP-SERVER.md** for installing it, locking the data, and seeing or changing players' stats from the dashboard. Don't upload `server-script.js` to GitHub, because it contains the admin password.

The `server/` folder and `render.yaml` came from the old self-hosted relay. They aren't used any more and can be deleted.

## Test locally

```bash
python -m http.server 8765
```

Then open `http://localhost:8765` in two browser tabs. Each tab counts as a different player.
