# swarm.green link pages for the app's share links

Since desktop 0.1.2 (B3) the app makes these links, each with the secret only
in the URL fragment, which a browser never sends to the server:

| Link                                        | Page on swarm.green | App form                          |
| ------------------------------------------- | ------------------- | --------------------------------- |
| `https://swarm.green/u/#eu/<username code>` | `/u/`               | `swarm://swarm.green/u/#eu/…`     |
| `https://swarm.green/g/#<invite code>`      | `/g/`               | `swarm://swarm.green/g/#…`        |
| `https://swarm.green/stickers/#pack_id=…`   | `/stickers/`        | `swarm://swarm.green/stickers/#…` |

`index.html` here is one static page that serves all three: it reads the path
to choose its wording, builds the `swarm://` address from its own location with
the fragment kept, tries to open the app once, and leaves an "Open in SWARM
Messenger" button plus a download link. No script or style is loaded from
anywhere; the page needs nothing but the file.

## Install on the server (same as the existing `/call/` page)

Copy the file to the three directories the web server serves for swarm.green:

```
/u/index.html
/g/index.html
/stickers/index.html
```

Then check in a browser that `https://swarm.green/u/#eu/test` shows the page
(not the 404 "This cell is empty") and that the button's address begins with
`swarm://swarm.green/u/#eu/test`. On a PC with 0.1.2 installed, the button and
the automatic attempt open the app.
