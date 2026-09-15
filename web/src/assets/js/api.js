const TOKEN_KEY = 'lamai.token';

function getToken() {
  return window.localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token) {
  if (token) {
    window.localStorage.setItem(TOKEN_KEY, token);
  } else {
    window.localStorage.removeItem(TOKEN_KEY);
  }
}

export function clearToken() {
  window.localStorage.removeItem(TOKEN_KEY);
}

export function api(method, payload) {
  const body = payload && typeof payload === 'object' ? payload : {};
  return new Promise((resolve, reject) => {
    if (!(window.google && window.google.script && window.google.script.run)) {
      reject(new Error('Open this workspace from the deployed Apps Script URL so staff share one list.'));
      return;
    }
    window.google.script.run
      .withSuccessHandler((result) => {
        if (result && result.ok === false) {
          const error = new Error(result.message || 'Request failed');
          error.code = result.code;
          error.payload = result;
          reject(error);
          return;
        }
        resolve(result && Object.prototype.hasOwnProperty.call(result, 'data') ? result.data : result);
      })
      .withFailureHandler((error) => {
        reject(error instanceof Error ? error : new Error(String(error)));
      })
      .api({
        method: method,
        token: getToken(),
        payload: body
      });
  });
}
