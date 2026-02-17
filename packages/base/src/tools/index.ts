export {
  handlers as bashHandlers,
  exec as bashExec,
  script as bashScript,
} from './bash.js';

export {
  handlers as fileSystemHandlers,
  read as fileRead,
  write as fileWrite,
  list as fileList,
  mkdir as fileMkdir,
} from './file-system.js';

export {
  handlers as agentsHandlers,
  request as agentsRequest,
  send as agentsSend,
  spawn as agentsSpawn,
  list as agentsList,
  catalog as agentsCatalog,
} from './agents.js';

export {
  handlers as httpFetchHandlers,
  get as httpFetchGet,
  post as httpFetchPost,
} from './http-fetch.js';

export {
  handlers as jsonQueryHandlers,
  query as jsonQueryQuery,
  pick as jsonQueryPick,
  count as jsonQueryCount,
  flatten as jsonQueryFlatten,
} from './json-query.js';

export {
  handlers as textTransformHandlers,
  replace as textTransformReplace,
  slice as textTransformSlice,
  split as textTransformSplit,
  join as textTransformJoin,
  trim as textTransformTrim,
  caseTransform as textTransformCase,
} from './text-transform.js';

export {
  handlers as telegramHandlers,
  send as telegramSend,
  edit as telegramEdit,
  remove as telegramDelete,
  react as telegramReact,
  setChatAction as telegramSetChatAction,
  downloadFile as telegramDownloadFile,
} from './telegram.js';

export {
  handlers as slackHandlers,
  send as slackSend,
  read as slackRead,
  edit as slackEdit,
  remove as slackDelete,
  react as slackReact,
  downloadFile as slackDownloadFile,
} from './slack.js';

export {
  handlers as selfRestartHandlers,
  request as selfRestartRequest,
} from './self-restart.js';
