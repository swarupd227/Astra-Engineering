#!/usr/bin/env node
require('dotenv').config();
(async function(){
  const org = process.env.ADO_ORG;
  const project = process.env.ADO_PROJECT;
  const pat = process.env.ADO_PAT;
  if (!org || !project || !pat) {
    console.error('Missing ADO_ORG, ADO_PROJECT, or ADO_PAT in environment');
    process.exit(2);
  }
  const url = `https://dev.azure.com/${org}/${project}/_apis/pipelines?api-version=6.0-preview.1`;
  const auth = 'Basic ' + Buffer.from(':' + pat).toString('base64');
  try {
    const res = await fetch(url, { headers: { Authorization: auth }, method: 'GET' });
    console.log('ADO list pipelines status:', res.status);
    const text = await res.text();
    try { console.log(JSON.parse(text)); } catch (e) { console.log(text); }
    process.exit(res.ok ? 0 : 1);
  } catch (err) {
    console.error('Error querying ADO:', err && err.message ? err.message : err);
    process.exit(3);
  }
})();
