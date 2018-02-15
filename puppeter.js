'use strict';

const puppeteer = require('puppeteer');
const path = require('path');

(async() => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  const url = 'file://' + path.join(__dirname, 'TypeNes') + '/index.html';
  await process.stdout.write(url);
  await page.goto(url);
  await page.screenshot({path: 'screenshot.png'});
  await browser.close();
})()
;
