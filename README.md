# Freehire Interviews

A standalone macOS app for recording interviews, transcribing them through Freehire, and attaching a transcript to a private Freehire tracker entry.

- Sign in through your browser with your Freehire account.
- Choose **Record Interview** in the app or accept a call prompt. Stop to save the audio on your Mac.
- Play the local recording and choose **Generate Transcript** to send the audio to Freehire for inference.
- Review the text and choose **Save to Private Tracker** to attach it to an existing interview or application.

## Run locally

Requires macOS 14.2 or later, Node.js 24 and the Xcode Command Line Tools.

```sh
npm ci
npm start
```

Allow microphone and system audio access when prompted. Settings includes an audio access check and a switch for call prompts.

The desktop app uses `https://freehire.me` by default. For a local backend, run `FREEHIRE_INTERVIEW_API_ORIGIN=http://127.0.0.1:8080 npm start`. Development builds support an absolute `FREEHIRE_INTERVIEW_PROFILE` path for an isolated test profile. The default development profile matches earlier Freehire Interviews development builds.

```sh
npm test
npm run typecheck
npm run pack:mac
```

The macOS capture helpers and parts of the desktop app are adapted from [OpenWhispr](https://github.com/OpenWhispr/openwhispr) under the included MIT license.
