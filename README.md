# Playlet

Playlet plays songs/media on any DLNA server
Open your NAS media index page, run the bookmarklet, and get an inline player UI without installing a native client.

## Story

I have a NAS, it provides a DLNA server to host my song collections.

But I hate install a DLNA compatible app on phone/macOS. It's hard to find a good one.

So on a Saturday I decided to build a client myself. While evaluating tech stack and distribution options, I tried to ask ChatGPT whether browsers provide SSDP/uPNP natively, turns out no. I even tried to build [a Chrome App with `chrome.socket`](https://github.com/est/push2air) 13 years ago but went nowhere. You have to choose native UI, electron (boo!), or some command line utility, which are mostly very boring.

Suddently I had an idea: a DLNA client involves speaking HTTP anyway, and the DLNA server already has a web server. There's an ancient lesser-known trick called "bookmarklet". I could inject a small `.js` into the ugly DLNA index page, then do `fetch()` calls and render a nice player inline. No UDP, no CORS, no bullshit.

The rest is vibe coding history.

## how it works

1. save this `javascript:import("https://est.github.io/playlet/loader.js")` to browser bookmark
2. open NAS DLNA index page
3. open the bookmark

the `loader.js` provide functions for:

1. Discover/load device description XML (`rootDesc.xml` or provided URL)
2. Find `ContentDirectory` `controlURL`
3. Send `Browse` SOAP requests (ObjectID, BrowseDirectChildren)
4. Parse `DIDL-Lite` results into containers/items
5. Play item res URLs in the UI
