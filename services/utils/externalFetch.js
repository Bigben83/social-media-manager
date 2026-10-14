const axios = require('axios');
const dns = require('dns').promises;
const net = require('net');
const http = require('http');
const https = require('https');
const blocked = new net.BlockList();
for (const [ip, mask] of [['0.0.0.0',8],['10.0.0.0',8],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.168.0.0',16],['100.64.0.0',10],['198.18.0.0',15],['224.0.0.0',4],['240.0.0.0',4]]) blocked.addSubnet(ip,mask,'ipv4');
for (const [ip,mask] of [['::',128],['::1',128],['fc00::',7],['fe80::',10],['ff00::',8]]) blocked.addSubnet(ip,mask,'ipv6');
function isPublicAddress(address) {
  const family = net.isIP(address);
  return family !== 0 && !blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}
async function publicTarget(raw, lookup = dns.lookup) {
  const url = new URL(raw);
  const hostname = url.hostname.replace(/^\[|\]$/g,'');
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || /(^|\.)(localhost|local)$/.test(hostname) || (url.port && !['80','443'].includes(url.port))) throw new Error('Use a public HTTP or HTTPS URL');
  const addresses = net.isIP(hostname) ? [{ address: hostname, family: net.isIP(hostname) }] : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error('Private network URLs are not allowed for external content');
  return { url, addresses };
}
async function externalGet(raw, { maxBytes = 1024 * 1024, responseType = 'text', timeout = 15000, headers = {} } = {}) {
  for (let redirects = 0; redirects <= 5; redirects++) {
    const { url, addresses } = await publicTarget(raw);
    const lookup = (hostname, options, callback) => {
      const matching = addresses.filter(item => !options.family || item.family === options.family);
      if (!matching.length) return callback(new Error('No public address for the requested family'));
      if (options.all) return callback(null, matching);
      callback(null, matching[0].address, matching[0].family);
    };
    const httpAgent = new http.Agent({ lookup }); const httpsAgent = new https.Agent({ lookup });
    try {
      const response = await axios.get(url.href, { responseType, timeout, headers, maxContentLength: maxBytes, maxBodyLength: maxBytes, maxRedirects: 0, proxy: false, httpAgent, httpsAgent, validateStatus: status => status >= 200 && status < 400 });
      if (response.status >= 300 && response.headers.location) { raw = new URL(response.headers.location, url).href; continue; }
      return response;
    } finally { httpAgent.destroy(); httpsAgent.destroy(); }
  }
  throw new Error('Too many external redirects');
}
module.exports = { isPublicAddress, publicTarget, externalGet };
