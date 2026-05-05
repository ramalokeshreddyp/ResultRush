const axios = require('axios').default;
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const cheerio = require('cheerio');

const BASE_URL  = 'https://examsection.aec.edu.in';
const LOGIN_URL = `${BASE_URL}/Login.aspx`;
const MARKS_URL = `${BASE_URL}/StudentLogin/Student/OverallMarksSemwise.aspx`;
const HTNO = '23A91A05I2';

function createClient() {
  const jar = new CookieJar();
  return wrapper(axios.create({ jar, maxRedirects: 10, timeout: 20000 }));
}
function enc(obj) {
  return Object.entries(obj).map(function(p) { return encodeURIComponent(p[0])+'='+encodeURIComponent(p[1]||''); }).join('&');
}
function fields($) {
  return { __VIEWSTATE:$('input[name="__VIEWSTATE"]').val()||'', __VIEWSTATEGENERATOR:$('input[name="__VIEWSTATEGENERATOR"]').val()||'', __EVENTVALIDATION:$('input[name="__EVENTVALIDATION"]').val()||'', __EVENTTARGET:'', __EVENTARGUMENT:'' };
}

async function main() {
  const c = createClient();
  const r1 = await c.get(LOGIN_URL);
  let $ = cheerio.load(r1.data);
  const r2 = await c.post(LOGIN_URL, enc(Object.assign({},fields($),{__EVENTTARGET:'lnkStudent'})), {headers:{'Content-Type':'application/x-www-form-urlencoded'}});
  $ = cheerio.load(r2.data);
  const r3 = await c.post(LOGIN_URL, enc(Object.assign({},fields($),{txtUserId:HTNO,txtPwd:HTNO,btnLogin:'Login'})), {headers:{'Content-Type':'application/x-www-form-urlencoded'}});
  const r4 = await c.get(MARKS_URL);
  $ = cheerio.load(r4.data);

  // Table #20 is the course table - show its HTML
  var t20 = $('table').eq(20);
  console.log('=== Table #20 HTML ===');
  console.log(t20.html().slice(0, 3000));
  
  console.log('\n=== Table #21 HTML ===');
  var t21 = $('table').eq(21);
  console.log(t21.html().slice(0, 2000));
}
main().catch(function(e){console.error(e.message);});
