# Loop Studio

Loop Studio is a local workspace for event-driven AI workflows. Emit an event, match it to a loop, and inspect the model's output. Use schedules to publish recurring events while the local server is running.

## Start locally

Install Node.js 22 or later. Open the project folder and run:

```sh
npm start
```

Open [Loop Studio](http://127.0.0.1:4317) or the [project page preview](http://127.0.0.1:4317/project/). Use the printed loopback address if you set `PORT`.

The demo processor and example events are available on first launch. To try the end-to-end flow, emit the suggested `inbox.received` event and open **Runs** to inspect the result.

## Use your model

In **Model**, select **OpenAI-compatible endpoint**, enter its base URL (for example, `http://127.0.0.1:11434/v1` for a local Ollama instance), and enter an installed model's identifier. Loop appends `/chat/completions`. If the endpoint requires an API key, start Loop with `LOOP_MODEL_API_KEY` and `LOOP_MODEL_API_KEY_ORIGIN` set in your environment. Set the origin to the provider's scheme, host, and optional port, with the `/v1` path omitted. Loop sends the key only to that origin. Events matched by a loop are sent to the configured model provider.

## Connect a workflow

1. Create a loop with an event topic and model instruction.
2. Emit a JSON event from the console or a local integration.
3. Inspect the result under **Runs**. If you specify an output topic, a completed model run publishes its output as a follow-up event.
4. Create a schedule with the input topic to publish the same kind of event at a recurring interval. Pause, resume, edit, or emit from a schedule at any time.

```sh
curl http://127.0.0.1:4317/api/events \
  -H 'Content-Type: application/json' \
  -d '{"topic":"inbox.received","payload":{"subject":"Weekly notes"}}'
```

The server binds to IPv4 loopback and creates `local-data/` on first launch. Events, loops, schedules, model settings, and run history live there. Git ignores this directory. Set `LOOP_DATA_DIR` to use a different location. If you choose a directory inside a checkout, ensure Git ignores it too. Run one server per data directory.

Keep the server running for automatic processing. An overdue schedule emits once after restart and resumes its interval. A run interrupted mid-request appears as failed. Follow-up events stop triggering new runs at depth eight.

## Publish the project page

Push the source to a public GitHub repository and select **GitHub Actions** as the Pages source in repository settings. The included workflow publishes the `site/` project page on pushes to the default branch. It adds links to the repository and its source ZIP based on the actual repository name. The Pages artifact contains the explanatory site only. The runtime, local data, and credentials stay outside the artifact.

Run `npm run build:pages` to build the static page locally into `dist/`.

## License

MIT
