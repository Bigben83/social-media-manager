const axios = require('axios');
function apiFailure(response) {
  const error = response.data?.error;
  if (error?.code && error.code !== 'ok') throw Object.assign(new Error(error.message || error.code), { response: { status: 400, data: { error: { message: error.message || error.code } } } });
}
async function confirmTikTokPublish(baseUrl, accessToken, publishId, options = {}) {
  const request = options.request || axios.post;
  const delay = options.delay || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const attempts = options.attempts || 6;
  for (let i = 0; i < attempts; i++) {
    let response;
    try { response = await request(`${baseUrl}/post/publish/status/fetch/`, { publish_id: publishId }, { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 10000 }); apiFailure(response); }
    catch { throw Object.assign(new Error(`TikTok accepted upload ${publishId}, but its publishing outcome could not be checked; verify the account before resending`), { uncertain: true }); }
    const result = response.data?.data || {};
    if (result.status === 'PUBLISH_COMPLETE') return { publishId, postIds: result.publicaly_available_post_id || [], status: 'published' };
    if (result.status === 'FAILED') throw Object.assign(new Error(`TikTok publishing failed: ${result.fail_reason || 'unknown reason'}`), { response: { status: 400, data: { error: { message: result.fail_reason || 'Publishing failed' } } } });
    if (i < attempts - 1) await delay(3000);
  }
  throw Object.assign(new Error(`TikTok upload ${publishId} is still processing; check the account before resending`), { uncertain: true });
}
module.exports = { apiFailure, confirmTikTokPublish };
