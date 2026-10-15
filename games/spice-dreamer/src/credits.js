// Credits: the people whose work this game stands on, with links so players can go support them.

import { openInfoPanel } from './account-ui.js';

const link = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;

export const openCredits = () => openInfoPanel(`
  <h2>Credits</h2>
  <div class="arc-credit">
    <h3>Music</h3>
    <p>"Spice Dream" by <b>nic and reuben</b>, from <i>Somethin' Somethin'</i> (2018).</p>
    <p>${link('https://nicandreuben4000.bandcamp.com/track/spice-dream', 'Listen and buy it on Bandcamp')} &mdash; it's name your price, so throw them a few bucks.</p>
  </div>
  <div class="arc-credit">
    <h3>Inspired by</h3>
    <p><b>Black Emperor</b> by BumbleBear Games, the roll-the-wheel arcade motorcycle game this one is a love letter to.</p>
    <p>${link('https://bumblebeargames.com/products/black-emperor', 'Find out about Black Emperor')} and go play the real cabinet.</p>
  </div>
  <div class="arc-credit">
    <h3>Desert lore</h3>
    <p>A fan tribute to Frank Herbert's <i>Dune</i>.</p>
  </div>
  <div class="arc-credit">
    <h3>Built with</h3>
    <p>${link('https://github.com/KilledByAPixel/LittleJS', 'LittleJS')} by Frank Force.</p>
  </div>
  <p class="arc-small">Spice Dreamer is a free, non-commercial fan project on ${link('https://games.ope.cool', 'games.ope.cool')}.</p>`);
