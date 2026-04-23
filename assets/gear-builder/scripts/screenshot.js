import { Slots } from "./data.js";

$(document).ready(function() {
    $('.copypic').click(function(e) {
    var cardid = $(e.target).closest('div.tab-pane').find('.buildcard').prop('id');
    var cardstring = String(cardid);
    var cardnum = cardstring.slice(4) - 1;

    html2canvas($('.buildcard')[cardnum], {backgroundColor: '#2f2f2f'}).then((canvas) => {
        canvas.toBlob(blob => navigator.clipboard.write([new ClipboardItem({'image/png': blob})]))
    });
})})


$(document).ready(function() {
    $('.savepic').click(function(e) {
    var cardid = $(e.target).closest('div.tab-pane').find('.buildcard').prop('id');
    var cardstring = String(cardid);
    var cardnum = cardstring.slice(4) - 1;
    var cardname = Slots.find(k=>k.num==cardnum)?.char;
    var build = $(e.target).closest('div.tab-pane').find('div.cardbuild').html()

    html2canvas($('.buildcard')[cardnum], {backgroundColor: '#2f2f2f'}).then((canvas) => {
        canvas.toBlob(blob => window.saveAs(blob, String(cardname)+' ('+String(build)+')'));
    });
})})


$(document).ready(function() {
    $('.copytext').click(function(e) {
        var str = $(e.target).closest('div.tab-pane').find('div.str').html();
        var spd = $(e.target).closest('div.tab-pane').find('div.spe').html();
        var sho = $(e.target).closest('div.tab-pane').find('div.sho').html();
        var pas = $(e.target).closest('div.tab-pane').find('div.pas').html();
        var tec = $(e.target).closest('div.tab-pane').find('div.tec').html();
        var build = $(e.target).closest('div.tab-pane').find('div.cardbuild').html();
        var capchar = $(e.target).closest('div.tab-pane').find('div.cardchar').html();
        var char = capchar.slice(0,1)+capchar.slice(1).toLowerCase()
        var text = char+' ('+build+') '+str+' | '+spd+' | '+sho+' | '+pas+' | '+tec;
        var dummy = document.createElement("input");
        
        document.body.appendChild(dummy);
        dummy.setAttribute("id", "dummy_id");
        document.getElementById("dummy_id").value=text;
        dummy.select();
        navigator.clipboard.writeText(dummy.value)
        document.body.removeChild(dummy);
})})
