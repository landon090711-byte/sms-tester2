const express = require('express');
const { chromium } = require('playwright-core');
const sites = require('./sites');

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head><title>SMS Tester</title>
<style>
body { font-family: monospace; background: #0d0d0d; color: #0f0; padding: 20px; }
input, button { padding: 10px; font-size: 16px; border-radius: 5px; }
input { background: #1a1a1a; color: #fff; border: 1px solid #333; width: 200px; }
button { background: #0f0; color: #000; border: none; cursor: pointer; }
button:hover { background: #0c0; }
#log { margin-top: 20px; background: #111; padding: 15px; border-radius: 5px; max-height: 400px; overflow-y: auto; }
.success { color: #0f0; }
.failed { color: #f00; }
.info { color: #ff0; }
</style>
</head>
<body>
<h1>📱 SMS Tester</h1>
<input type="text" id="phone" placeholder="Enter phone number" value="6199176403">
<button id="startBtn">▶ Start</button>
<button id="stopBtn" disabled>■ Stop</button>
<div id="stats">Ready</div>
<div id="log"></div>
<script>
const log = document.getElementById('log');
const stats = document.getElementById('stats');
const phoneInput = document.getElementById('phone');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
let running = false;
let eventSource = null;

function addLog(msg, type = 'info') {
  const div = document.createElement('div');
  div.className = type;
  div.textContent = msg;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function startTest() {
  const phone = phoneInput.value.trim();
  if (!phone) { alert('Enter a phone number'); return; }
  
  running = true;
  startBtn.disabled = true;
  stopBtn.disabled = false;
  log.innerHTML = '';
  addLog('🚀 Starting test for ' + phone, 'info');
  
  const es = new EventSource('/stream?phone=' + encodeURIComponent(phone));
  eventSource = es;
  
  es.onmessage = function(event) {
    const data = JSON.parse(event.data);
    if (data.type === 'result') {
      const statusClass = data.result.status === 'success' ? 'success' : 'failed';
      addLog(data.result.site + ': ' + data.result.status + (data.result.error ? ' - ' + data.result.error : ''), statusClass);
    } else if (data.type === 'complete') {
      addLog('✅ Test complete!', 'success');
      stats.textContent = '📊 ' + data.results.success + ' success, ' + data.results.failed + ' failed';
      running = false;
      startBtn.disabled = false;
      stopBtn.disabled = true;
      es.close();
    }
  };
}

function stopTest() {
  if (!running) return;
  fetch('/stop?phone=' + encodeURIComponent(phoneInput.value.trim()), { method: 'POST' });
  addLog('⏹ Stopped by user', 'info');
  running = false;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  if (eventSource) eventSource.close();
}

startBtn.addEventListener('click', startTest);
stopBtn.addEventListener('click', stopTest);
</script>
</body>
</html>
  `);
});

app.get('/stream', async (req, res) => {
  const phone = req.query.phone;
  if (!phone) return res.status(400).json({ error: 'Phone required' });
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  let browser = null;
  let stopped = false;
  
  const stopKey = 'stop_' + phone;
  global[stopKey] = () => { stopped = true; };
  
  try {
    browser = await chromium.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    
    let success = 0;
    let failed = 0;
    
    for (const site of sites) {
      if (stopped) break;
      
      const page = await browser.newPage();
      try {
        await page.goto(site.url, { waitUntil: 'networkidle2', timeout: 30000 });
        await page.waitForSelector(site.selectors.phone, { timeout: 10000 });
        await page.type(site.selectors.phone, phone);
        await page.click(site.selectors.submit);
        await page.waitForTimeout(3000);
        success++;
        res.write('data: ' + JSON.stringify({ type: 'result', result: { site: site.name, status: 'success' } }) + '\n\n');
      } catch (error) {
        failed++;
        res.write('data: ' + JSON.stringify({ type: 'result', result: { site: site.name, status: 'failed', error: error.message } }) + '\n\n');
      } finally {
        await page.close();
      }
    }
    
    res.write('data: ' + JSON.stringify({ type: 'complete', results: { success, failed } }) + '\n\n');
  } catch (error) {
    res.write('data: ' + JSON.stringify({ type: 'error', error: error.message }) + '\n\n');
  } finally {
    if (browser) await browser.close();
    res.end();
    delete global[stopKey];
  }
});

app.post('/stop', (req, res) => {
  const phone = req.query.phone;
  if (phone && global['stop_' + phone]) {
    global['stop_' + phone]();
  }
  res.json({ status: 'stopped' });
});

module.exports = app;
