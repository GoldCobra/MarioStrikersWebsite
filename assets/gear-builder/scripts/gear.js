import { Gear, Slots } from "./data.js";
const STATS_IMAGE_BASE_URL = new URL("../images/stats/", import.meta.url).href;

$(document).ready(function() {
  $('.button').click(function(e) {
    var bname = e.target.textContent;
    var bclass = this.className.split(' ')[0];
    var bnum = Slots.find(k=>k.name==bname)?.num;
    var bslot = Slots.find(k=>k.slot==bclass)?.num;
    var tableid = $(e.target).closest('div.tab-pane').find('table').prop('id');
    var gtable = document.getElementById(tableid);
    
    let filtered = Gear.filter(function (a) {return a.name===bname && a.slot===bclass});
    var bstat = filtered.find(k=>k.name==bname)?.stats;
    let z = Number(bslot)+3;
    for(var j=0; j<5; j++) {gtable.rows[z].cells[j+1].innerHTML=bstat[j]};

    var bcell = $(e.target).closest('div.tab-pane').find('td.buildcell').prop('id');
    var element = document.getElementById(bcell);
    var str = element.getAttribute('builddata');
    var front = str.slice(0,bslot);
    var back = str.slice(++bslot,4);
    var newbuild = front+bnum+back;
    element.setAttribute('builddata', newbuild);

    for(var i=1; i<6; i++){ 
      let sum = 0; 
        for(var j=2; j<7; j++){
          sum += Number(gtable.rows[j].cells[i].innerHTML);
            {gtable.rows[1].cells[i].innerHTML=sum}
        }
    }

    var strength = gtable.rows[1].cells[1].textContent;
    var speed = gtable.rows[1].cells[2].textContent;
    var shot = gtable.rows[1].cells[3].textContent;
    var pass = gtable.rows[1].cells[4].textContent;
    var tech = gtable.rows[1].cells[5].textContent;
    var tipvalue = parseFloat(((speed*.39)+(tech*.1)-3.15)*2).toFixed(1);
    if(tipvalue < 1) {tipvalue = 1};

    $(e.target).closest('div.tab-pane').find('div.str').html(strength);
    $(e.target).closest('div.tab-pane').find('div.spe').html(speed);
    $(e.target).closest('div.tab-pane').find('div.sho').html(shot);
    $(e.target).closest('div.tab-pane').find('div.pas').html(pass);
    $(e.target).closest('div.tab-pane').find('div.tec').html(tech);
    $(e.target).closest('div.tab-pane').find('img.str').attr("src", STATS_IMAGE_BASE_URL + strength + '.png');
    $(e.target).closest('div.tab-pane').find('img.spe').attr("src", STATS_IMAGE_BASE_URL + speed + '.png');
    $(e.target).closest('div.tab-pane').find('img.sho').attr("src", STATS_IMAGE_BASE_URL + shot + '.png');
    $(e.target).closest('div.tab-pane').find('img.pas').attr("src", STATS_IMAGE_BASE_URL + pass + '.png');
    $(e.target).closest('div.tab-pane').find('img.tec').attr("src", STATS_IMAGE_BASE_URL + tech + '.png');
    $(e.target).closest('div.tab-pane').find('div.cardbuild').html(newbuild);
    $(e.target).closest('div.tab-pane').find('div.tooltip').html('Speed with Ball: '+tipvalue);
  })
})
