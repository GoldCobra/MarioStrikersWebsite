$(document).ready(function(){
    $('.button').click(function(){
         $(this).addClass('activebutton').siblings().removeClass('activebutton');
    });
});
