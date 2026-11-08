'use strict';
// Suara Windows (Windows.Media.SpeechSynthesis) lewat PowerShell -> WAV.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runScript, readJsonFile } = require('./winps');

let voiceCache = null;

async function listVoices() {
  if (voiceCache) return voiceCache;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bacalayar-'));
  const out = path.join(dir, 'voices.json');
  try {
    await runScript('win-voices.ps1', ['-OutFile', out], 30000);
    const data = readJsonFile(fs, out);
    const voices = Array.isArray(data.voices) ? data.voices : data.voices ? [data.voices] : [];
    voiceCache = { voices, defaultId: data.defaultId || '' };
    return voiceCache;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** @returns {Promise<Buffer>} WAV */
async function synth(text, voiceId, rate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bacalayar-'));
  const inFile = path.join(dir, 'teks.txt');
  const outFile = path.join(dir, 'suara.wav');
  try {
    fs.writeFileSync(inFile, text, 'utf8');
    const args = ['-TextFile', inFile, '-OutFile', outFile, '-Rate', String(Number(rate) || 1)];
    if (voiceId) args.push('-VoiceId', voiceId);
    await runScript('win-tts.ps1', args, 120000);
    return fs.readFileSync(outFile);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { listVoices, synth };
