# @indaba/server

The local server behind `indaba ui`, the web view of [Indaba](https://github.com/yaotzin1/indaba). It serves the page and a token-protected HTTP
and Server-Sent Events API for the runs on this machine. Optional: `indaba` works without it.

```bash
npm install -g indaba@next @indaba/server@next
indaba ui
```

The page lists your runs and follows one live as a graph, with each step's tries, output and cost. It starts and
stops runs, lists the workflows of your folders, and edits a workflow as a form, a graph or text.

## Safety

- It listens on this machine only, and every request needs the token in the address `indaba ui` opens.
- It answers only its own page: requests from another origin or host are refused.
- To run, save or change a workflow, the page sends an id from the list, never a path.
- Ctrl+C stops the server and the runs it started.

The details are in [Web view](https://yaotzin1.github.io/indaba/web-view.html).

## Links

- Documentation: https://yaotzin1.github.io/indaba/
- Source, issues and changelog: https://github.com/yaotzin1/indaba

## Licence

MIT
