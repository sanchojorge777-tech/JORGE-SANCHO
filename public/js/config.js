// Settings you can change. Everything else works as it is.
export const CONFIG = {
  // Name shown in the app.
  APP_NAME: 'Boardroom Quiz',
  TAGLINE: 'Make the call. Move the company.',

  // How phones talk to the host screen:
  //   'auto'  -> uses the relay server if the site runs on one (server.js), otherwise connects directly.
  //   'relay' -> always use the relay server.
  //   'p2p'   -> always connect directly (no server needed).
  TRANSPORT: 'relay',

  // Seconds players have to answer each question (a question can set its own "seconds").
  SECONDS_PER_QUESTION: 30,
  // Short "get ready" countdown before each question.
  READY_SECONDS: 3,

  // Longest nickname allowed.
  MAX_NAME: 16,
  // Players shown in the leaderboard after each question.
  TOP_N: 5,

  // Direct mode only: prefix for the game id and optional connection-service override.
  PEER_PREFIX: 'bqz-',
  PEER_OPTIONS: {},
};
