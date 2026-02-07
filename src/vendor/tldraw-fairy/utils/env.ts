export const isDevelopmentEnv =
  typeof process !== 'undefined' ? process.env.NODE_ENV !== 'production' : false;
