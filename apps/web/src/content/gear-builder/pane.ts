// The markup of one Gear Builder character pane, loaded into the builder when its tab is first chosen
// (served at /pages/templates/msbl-gear-builder/panes/<slug>.html). It must stay exactly as the
// snapshot's scripts expect it: ids, classes and whitespace are theirs.

import type { GearCharacter } from "./characters.ts";

export function renderPane(c: GearCharacter): string {
  const number = String(c.index).padStart(2, "0");
  // Button ids: "btn" + (index - 1, empty for the first character) + part (0/2/4/6) + gear (0..9).
  const prefix = c.index === 1 ? "" : String(c.index - 1);
  return `          <div class="tab-pane hidden" id="tab-${number}" role="tabpanel" aria-labelledby="tab-${number}-link">
            <div class="container">
              <div class="table hidden">
                <table class="gear-table" id="table${number}">
                  <colgroup>
                    <col width="20%">
                    <col width="16%">
                    <col width="16%">
                    <col width="16%">
                    <col width="16%">
                    <col width="16%">
                  </colgroup>
                  <thead class="table-header">
                    <tr style="height: 40px;">
                      <th class="cell">${c.name}</th>
                      <th class="cell">Strength</th>
                      <th class="cell">Speed</th>
                      <th class="cell">Shot</th>
                      <th class="cell">Pass</th>
                      <th class="cell">Tech</th>
                    </tr>
                  </thead>
                  <tbody class="table-body">
                    <tr class="first-row" style="height: 40px;">
                      <td class="buildcell first-column" id="${c.abbreviation}" builddata="0000"></td>
                      <td class="cell">${c.stats[0]}</td>
                      <td class="cell">${c.stats[1]}</td>
                      <td class="cell">${c.stats[2]}</td>
                      <td class="cell">${c.stats[3]}</td>
                      <td class="cell">${c.stats[4]}</td>
                    </tr>
                    <tr class="hidrow" style="height: 40px;">
                      <td class="cell first-column">Base</td>
                      <td class="cell">${c.stats[0]}</td>
                      <td class="cell">${c.stats[1]}</td>
                      <td class="cell">${c.stats[2]}</td>
                      <td class="cell">${c.stats[3]}</td>
                      <td class="cell">${c.stats[4]}</td>
                    </tr>
                    <tr class="hidrow" style="height: 40px;">
                      <td class="cell first-column">Head</td>
                      <td class="cell"></td>
                      <td class="cell"></td>
                      <td class="cell"></td>
                      <td class="cell"></td>
                      <td class="cell"></td>
                    </tr>
                    <tr class="hidrow" style="height: 40px;">
                      <td class="cell first-column">Arms</td>
                      <td class="cell"></td>
                      <td class="cell"></td>
                      <td class="cell"></td>
                      <td class="cell"></td>
                      <td class="cell"></td>
                    </tr>
                    <tr class="hidrow" style="height: 40px;">
                      <td class="cell first-column">Body</td>
                      <td class="cell"></td>
                      <td class="cell"></td>
                      <td class="cell"></td>
                      <td class="cell"></td>
                      <td class="cell"></td>
                    </tr>
                    <tr class="hidrow" style="height: 40px;">
                      <td class="cell first-column">Legs</td>
                      <td class="cell"></td>
                      <td class="cell"></td>
                      <td class="cell"></td>
                      <td class="cell"></td>
                      <td class="cell"></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="buildcard ${c.cssClass}" id="card${c.index}">
                <div class="cardpic">
                  <img src="../assets/gear-builder/images/characters/${c.image}">
                  <div class="cardchar ${c.cssClass}">${c.cardName}</div>
                  <div class="cardbuild ${c.cssClass}">0000</div>
                </div>
                <div class="cardstat">
                  <div class="strengthstat">
                    <div class="stat str">${c.stats[0]}</div>
                  </div>
                  <div class="speedstat">
                    <div class="stat spe">${c.stats[1]}</div>
                  </div>
                  <div class="shotstat">
                    <div class="stat sho">${c.stats[2]}</div>
                  </div>
                  <div class="passstat">
                    <div class="stat pas">${c.stats[3]}</div>
                  </div>
                  <div class="techstat">
                    <div class="stat tec">${c.stats[4]}</div>
                  </div>
                </div>
                <div class="statbar">
                  <div class="strengthbar">
                    <img class="bar str" src="../assets/gear-builder/images/stats/${c.stats[0]}.png">
                    <img class="baricon" src="../assets/gear-builder/images/icons/strength.png">
                  </div>
                  <div class="speedbar">
                    <img class="bar spe" src="../assets/gear-builder/images/stats/${c.stats[1]}.png">
                    <img class="baricon" src="../assets/gear-builder/images/icons/speed.png">
                  </div>
                  <div class="shotbar">
                    <img class="bar sho" src="../assets/gear-builder/images/stats/${c.stats[2]}.png">
                    <img class="baricon" src="../assets/gear-builder/images/icons/shot.png">
                  </div>
                  <div class="passbar">
                    <img class="bar pas" src="../assets/gear-builder/images/stats/${c.stats[3]}.png">
                    <img class="baricon" src="../assets/gear-builder/images/icons/pass.png">
                  </div>
                  <div class="techbar">
                    <img class="bar tec" src="../assets/gear-builder/images/stats/${c.stats[4]}.png">
                    <img class="baricon" src="../assets/gear-builder/images/icons/tech.png">
                    <div class="tooltip ${c.cssClass}" id="tip${c.index}">Speed with Ball: ${c.speedWithBall}</div>
                  </div>
                </div>
              </div>
              <div class="button-div">
              <div class="button-grid">
                <div class="button-list button-list-1">
                <div class="button-container">
                  <button id="btn${prefix}00" class="head button activebutton">
                    <div class="arrows">
                    </div>
                    <div class="btnname">No Gear</div>
                  </button>
                  <button id="btn${prefix}01" class="head button">
                    <div class="arrows">
                      <i class="up2"></i>
                      <i class="equal">-</i>
                      <i class="equal">-</i>
                      <i class="equal">-</i>
                      <i class="down2"></i>
                    </div>
                    <div class="btnname">Muscle</div>
                  </button>
                  <button id="btn${prefix}02" class="head button">
                    <div class="arrows">
                      <i class="equal">-</i>
                      <i class="up2"></i>
                      <i class="equal">-</i>
                      <i class="equal">-</i>
                      <i class="down2"></i>
                    </div>
                    <div class="btnname">Turbo</div>
                  </button>
                  <button id="btn${prefix}03" class="head button">
                    <div class="arrows">
                      <i class="equal">-</i>
                      <i class="equal">-</i>
                      <i class="up2"></i>
                      <i class="equal">-</i>
                      <i class="down2"></i>
                    </div>
                    <div class="btnname">Cannon</div>
                  </button>
                  <button id="btn${prefix}04" class="head button">
                    <div class="arrows">
                      <i class="equal">-</i>
                      <i class="down2"></i>
                      <i class="equal">-</i>
                      <i class="up2"></i>
                      <i class="equal">-</i>
                    </div>
                    <div class="btnname">Chain</div>
                  </button>
                  <button id="btn${prefix}05" class="head button">
                    <div class="arrows">
                      <i class="equal">-</i>
                      <i class="equal">-</i>
                      <i class="equal">-</i>
                      <i class="down2"></i>
                      <i class="up2"></i>
                    </div>
                    <div class="btnname">Trick</div>
                  </button>
                  <button id="btn${prefix}06" class="head button">
                    <div class="arrows">
                      <i class="down1"></i>
                      <i class="down1"></i>
                      <i class="down1"></i>
                      <i class="up4"></i>
                      <i class="down1"></i>
                    </div>
                    <div class="btnname">Bushido</div>
                  </button>
                  <button id="btn${prefix}07" class="head button">
                    <div class="arrows">
                      <i class="up2"></i>
                      <i class="down2"></i>
                      <i class="up1"></i>
                      <i class="up1"></i>
                      <i class="down2"></i>
                    </div>
                    <div class="btnname">Knight</div>
                  </button>
                  <button id="btn${prefix}08" class="head button">
                    <div class="arrows">
                      <i class="down2"></i>
                      <i class="up1"></i>
                      <i class="up2"></i>
                      <i class="up1"></i>
                      <i class="down2"></i>
                    </div>
                    <div class="btnname">Barrel</div>
                  </button>
                  <button id="btn${prefix}09" class="head button">
                    <div class="arrows">
                      <i class="down2"></i>
                      <i class="up2"></i>
                      <i class="down1"></i>
                      <i class="down1"></i>
                      <i class="up2"></i>
                    </div>
                    <div class="btnname">Shellfish</div>
                  </button>
                </div>
                </div>
                <div class="button-list button-list-2">
                <div class="button-container">
                  <button id="btn${prefix}20" class="arms button activebutton">
                    <div class="arrows">
                    </div>
                    <div class="btnname">No Gear</div>
                  </button>
                  <button id="btn${prefix}21" class="arms button">
                    <div class="arrows">
                      <i class="up2"></i>
                      <i class="equal">-</i>
                      <i class="equal">-</i>
                      <i class="down2"></i>
                      <i class="equal">-</i>
                    </div>
                    <div class="btnname">Muscle</div>
                  </button>
                  <button id="btn${prefix}22" class="arms button">
                    <div class="arrows">
                      <i class="down2"></i>
                      <i class="up2"></i>
                      <i class="equal">-</i>
                      <i class="equal">-</i>
                      <i class="equal">-</i>
                    </div>
                    <div class="btnname">Turbo</div>
                  </button>
                  <button id="btn${prefix}23" class="arms button">
                    <div class="arrows">
                      <i class="equal">-</i>
                      <i class="down2"></i>
                      <i class="up2"></i>
                      <i class="equal">-</i>
                      <i class="equal">-</i>
                    </div>
                    <div class="btnname">Cannon</div>
                  </button>
                  <button id="btn${prefix}24" class="arms button">
                    <div class="arrows">
                      <i class="equal">-</i>
                      <i class="equal">-</i>
                      <i class="down2"></i>
                      <i class="up2"></i>
                      <i class="equal">-</i>
                    </div>
                    <div class="btnname">Chain</div>
                  </button>
                  <button id="btn${prefix}25" class="arms button">
                    <div class="arrows">
                      <i class="equal">-</i>
                      <i class="down2"></i>
                      <i class="equal">-</i>
                      <i class="equal">-</i>
                      <i class="up2"></i>
                    </div>
                    <div class="btnname">Trick</div>
                  </button>
                  <button id="btn${prefix}26" class="arms button">
                    <div class="arrows">
                      <i class="down1"></i>
                      <i class="down1"></i>
                      <i class="down1"></i>
                      <i class="down1"></i>
                      <i class="up4"></i>
                    </div>
                    <div class="btnname">Bushido</div>
                  </button>
                  <button id="btn${prefix}27" class="arms button">
                    <div class="arrows">
                      <i class="up2"></i>
                      <i class="up1"></i>
                      <i class="up1"></i>
                      <i class="down2"></i>
                      <i class="down2"></i>
                    </div>
                    <div class="btnname">Knight</div>
                  </button>
                  <button id="btn${prefix}28" class="arms button">
                    <div class="arrows">
                      <i class="down2"></i>
                      <i class="down2"></i>
                      <i class="up2"></i>
                      <i class="up1"></i>
                      <i class="up1"></i>
                    </div>
                    <div class="btnname">Barrel</div>
                  </button>
                  <button id="btn${prefix}29" class="arms button">
                    <div class="arrows">
                      <i class="up1"></i>
                      <i class="up2"></i>
                      <i class="down2"></i>
                      <i class="down2"></i>
                      <i class="up1"></i>
                    </div>
                    <div class="btnname">Shellfish</div>
                  </button>
                </div>
                </div>
                <div class="button-list button-list-3">
                <div class="button-container">
                  <button id="btn${prefix}40" class="body button activebutton">
                    <div class="arrows">
                    </div>
                    <div class="btnname">No Gear</div>
                  </button>
                  <button id="btn${prefix}41" class="body button">
                    <div class="arrows">
                      <i class="up2"></i>
                      <i class="equal">-</i>
                      <i class="down2"></i>
                      <i class="equal">-</i>
                      <i class="equal">-</i>
                    </div>
                    <div class="btnname">Muscle</div>
                  </button>
                  <button id="btn${prefix}42" class="body button">
                    <div class="arrows">
                      <i class="equal">-</i>
                      <i class="up2"></i>
                      <i class="equal">-</i>
                      <i class="down2"></i>
                      <i class="equal">-</i>
                    </div>
                    <div class="btnname">Turbo</div>
                  </button>
                  <button id="btn${prefix}43" class="body button">
                    <div class="arrows">
                      <i class="down2"></i>
                      <i class="equal">-</i>
                      <i class="up2"></i>
                      <i class="equal">-</i>
                      <i class="equal">-</i>
                    </div>
                    <div class="btnname">Cannon</div>
                  </button>
                  <button id="btn${prefix}44" class="body button">
                    <div class="arrows">
                      <i class="equal">-</i>
                      <i class="equal">-</i>
                      <i class="equal">-</i>
                      <i class="up2"></i>
                      <i class="down2"></i>
                    </div>
                    <div class="btnname">Chain</div>
                  </button>
                  <button id="btn${prefix}45" class="body button">
                    <div class="arrows">
                      <i class="down2"></i>
                      <i class="equal">-</i>
                      <i class="equal">-</i>
                      <i class="equal">-</i>
                      <i class="up2"></i>
                    </div>
                    <div class="btnname">Trick</div>
                  </button>
                  <button id="btn${prefix}46" class="body button">
                    <div class="arrows">
                      <i class="up4"></i>
                      <i class="down1"></i>
                      <i class="down1"></i>
                      <i class="down1"></i>
                      <i class="down1"></i>
                    </div>
                    <div class="btnname">Bushido</div>
                  </button>
                  <button id="btn${prefix}47" class="body button">
                    <div class="arrows">
                      <i class="up2"></i>
                      <i class="down2"></i>
                      <i class="up1"></i>
                      <i class="down2"></i>
                      <i class="up1"></i>
                    </div>
                    <div class="btnname">Knight</div>
                  </button>
                  <button id="btn${prefix}48" class="body button">
                    <div class="arrows">
                      <i class="down1"></i>
                      <i class="down1"></i>
                      <i class="up2"></i>
                      <i class="up2"></i>
                      <i class="down2"></i>
                    </div>
                    <div class="btnname">Barrel</div>
                  </button>
                  <button id="btn${prefix}49" class="body button">
                    <div class="arrows">
                      <i class="down2"></i>
                      <i class="up2"></i>
                      <i class="up1"></i>
                      <i class="down2"></i>
                      <i class="up1"></i>
                    </div>
                    <div class="btnname">Shellfish</div>
                  </button>
                </div>
                </div>
                <div class="button-list button-list-4">
                <div class="button-container">
                  <button id="btn${prefix}60" class="legs button activebutton">
                    <div class="arrows">
                    </div>
                    <div class="btnname">No Gear</div>
                  </button>
                  <button id="btn${prefix}61" class="legs button">
                    <div class="arrows">
                      <i class="up2"></i>
                      <i class="down2"></i>
                      <i class="equal">-</i>
                      <i class="equal">-</i>
                      <i class="equal">-</i>
                    </div>
                    <div class="btnname">Muscle</div>
                  </button>
                  <button id="btn${prefix}62" class="legs button">
                    <div class="arrows">
                      <i class="equal">-</i>
                      <i class="up2"></i>
                      <i class="down2"></i>
                      <i class="equal">-</i>
                      <i class="equal">-</i>
                    </div>
                    <div class="btnname">Turbo</div>
                  </button>
                  <button id="btn${prefix}63" class="legs button">
                    <div class="arrows">
                      <i class="equal">-</i>
                      <i class="equal">-</i>
                      <i class="up2"></i>
                      <i class="down2"></i>
                      <i class="equal">-</i>
                    </div>
                    <div class="btnname">Cannon</div>
                  </button>
                  <button id="btn${prefix}64" class="legs button">
                    <div class="arrows">
                      <i class="down2"></i>
                      <i class="equal">-</i>
                      <i class="equal">-</i>
                      <i class="up2"></i>
                      <i class="equal">-</i>
                    </div>
                    <div class="btnname">Chain</div>
                  </button>
                  <button id="btn${prefix}65" class="legs button">
                    <div class="arrows">
                      <i class="equal">-</i>
                      <i class="equal">-</i>
                      <i class="down2"></i>
                      <i class="equal">-</i>
                      <i class="up2"></i>
                    </div>
                    <div class="btnname">Trick</div>
                  </button>
                  <button id="btn${prefix}66" class="legs button">
                    <div class="arrows">
                      <i class="down1"></i>
                      <i class="up4"></i>
                      <i class="down1"></i>
                      <i class="down1"></i>
                      <i class="down1"></i>
                    </div>
                    <div class="btnname">Bushido</div>
                  </button>
                  <button id="btn${prefix}67" class="legs button">
                    <div class="arrows">
                      <i class="up2"></i>
                      <i class="down2"></i>
                      <i class="up2"></i>
                      <i class="down1"></i>
                      <i class="down1"></i>
                    </div>
                    <div class="btnname">Knight</div>
                  </button>
                  <button id="btn${prefix}68" class="legs button">
                    <div class="arrows">
                      <i class="up1"></i>
                      <i class="down2"></i>
                      <i class="up2"></i>
                      <i class="up1"></i>
                      <i class="down2"></i>
                    </div>
                    <div class="btnname">Barrel</div>
                  </button>
                  <button id="btn${prefix}69" class="legs button">
                    <div class="arrows">
                      <i class="down2"></i>
                      <i class="up2"></i>
                      <i class="down2"></i>
                      <i class="up1"></i>
                      <i class="up1"></i>
                    </div>
                    <div class="btnname">Shellfish</div>
                  </button>
                </div>
              </div>
              </div>
              </div>
            </div>
            <div class="menu">
              <div class="menu-options">
                <!--<b class="Add">Add to Team</b>-->
                <b class="copytext">Copy as Text</b>
                <b class="copypic">Copy as Image</b>
                <b class="savepic">Save as Image</b>
              </div>
            </div>
          </div>
`;
}
