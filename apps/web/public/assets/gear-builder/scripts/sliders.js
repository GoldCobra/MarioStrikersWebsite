window.onload = function(){
    fillColor();
}

const minGap = 0;
const max = 25;
const slider1 = document.getElementById("strmin");
const slider2 = document.getElementById("strmax");
const min1 = document.getElementById("range1");
const max1 = document.getElementById("range2");
const slider3 = document.getElementById("spdmin");
const slider4 = document.getElementById("spdmax");
const min2 = document.getElementById("range3");
const max2 = document.getElementById("range4");
const slider5 = document.getElementById("shotmin");
const slider6 = document.getElementById("shotmax");
const min3 = document.getElementById("range5");
const max3 = document.getElementById("range6");
const slider7 = document.getElementById("passmin");
const slider8 = document.getElementById("passmax");
const min4 = document.getElementById("range7");
const max4 = document.getElementById("range8");
const slider9 = document.getElementById("techmin");
const slider10 = document.getElementById("techmax");
const min5 = document.getElementById("range9");
const max5 = document.getElementById("range10");


$(document).ready(function() {
    $('.sliders').on('input',function() {
    min1.value = Math.min(slider1.value,slider2.value);
    max1.value = Math.max(slider1.value,slider2.value);
    min2.value = Math.min(slider3.value,slider4.value);
    max2.value = Math.max(slider3.value,slider4.value);
    min3.value = Math.min(slider5.value,slider6.value);
    max3.value = Math.max(slider5.value,slider6.value);
    min4.value = Math.min(slider7.value,slider8.value);
    max4.value = Math.max(slider7.value,slider8.value);
    min5.value = Math.min(slider9.value,slider10.value);
    max5.value = Math.max(slider9.value,slider10.value);
    fillColor();
})
})

$(document).ready(function() {
    $('.input-min').on('input',function() {
    slider1.value = Math.min(min1.value,max1.value);
    slider2.value = Math.max(min1.value,max1.value);
    slider3.value = Math.min(min2.value,max2.value);
    slider4.value = Math.max(min2.value,max2.value);
    slider5.value = Math.min(min3.value,max3.value);
    slider6.value = Math.max(min3.value,max3.value);
    slider7.value = Math.min(min4.value,max4.value);
    slider8.value = Math.max(min4.value,max4.value);
    slider9.value = Math.min(min5.value,max5.value);
    slider10.value = Math.max(min5.value,max5.value); 
    fillColor();
})
})

$(document).ready(function() {
    $('.input-max').on('input',function() {
    slider1.value = Math.min(min1.value,max1.value);
    slider2.value = Math.max(min1.value,max1.value);
    slider3.value = Math.min(min2.value,max2.value);
    slider4.value = Math.max(min2.value,max2.value);
    slider5.value = Math.min(min3.value,max3.value);
    slider6.value = Math.max(min3.value,max3.value);
    slider7.value = Math.min(min4.value,max4.value);
    slider8.value = Math.max(min4.value,max4.value);
    slider9.value = Math.min(min5.value,max5.value);
    slider10.value = Math.max(min5.value,max5.value); 
    fillColor();
})
})

function fillColor(){
    percent1 = ((Math.min(slider1.value,slider2.value) - 1) / 24) * 100;
    percent2 = ((Math.max(slider1.value,slider2.value) - 1) / 24) * 100;
    slider1.style.background = `linear-gradient(to right, #ea9c4a ${percent1}% , #27090b ${percent1}% , #27090b ${percent2}%, #ea9c4a ${percent2}%)`;
    percent3 = ((Math.min(slider3.value,slider4.value) - 1) / 24) * 100;
    percent4 = ((Math.max(slider3.value,slider4.value) - 1) / 24) * 100;
    slider3.style.background = `linear-gradient(to right, #ea9c4a ${percent3}% , #27090b ${percent3}% , #27090b ${percent4}%, #ea9c4a ${percent4}%)`;
    percent5 = ((Math.min(slider5.value,slider6.value) - 1) / 24) * 100;
    percent6 = ((Math.max(slider5.value,slider6.value) - 1) / 24) * 100;
    slider5.style.background = `linear-gradient(to right, #ea9c4a ${percent5}% , #27090b ${percent5}% , #27090b ${percent6}%, #ea9c4a ${percent6}%)`;
    percent7 = ((Math.min(slider7.value,slider8.value) - 1) / 24) * 100;
    percent8 = ((Math.max(slider7.value,slider8.value) - 1) / 24) * 100;
    slider7.style.background = `linear-gradient(to right, #ea9c4a ${percent7}% , #27090b ${percent7}% , #27090b ${percent8}%, #ea9c4a ${percent8}%)`;
    percent9 = ((Math.min(slider9.value,slider10.value) - 1) / 24) * 100;
    percent10 = ((Math.max(slider9.value,slider10.value) - 1) / 24) * 100;
    slider9.style.background = `linear-gradient(to right, #ea9c4a ${percent9}% , #27090b ${percent9}% , #27090b ${percent10}%, #ea9c4a ${percent10}%)`;
}

