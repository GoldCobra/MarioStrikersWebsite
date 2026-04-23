$(document).ready(function() {
    $('td.copycell').click(function(e) {
        var row = $(e.target).closest('tr');
        var char = $(row).find('td:eq(0)').text();
        var build = $(row).find('td:eq(1)').html();
        var str = $(row).find('td:eq(2)').text();
        var spe = $(row).find('td:eq(3)').html();
        var sho = $(row).find('td:eq(4)').html();
        var pas = $(row).find('td:eq(5)').html();
        var tec = $(row).find('td:eq(6)').html();

        var text = char+' ('+build+') '+str+' | '+spe+' | '+sho+' | '+pas+' | '+tec;
        var dummy = document.createElement("input");
        
        document.body.appendChild(dummy);
        dummy.setAttribute("id", "dummy_id");
        document.getElementById("dummy_id").value=text;
        dummy.select();
        navigator.clipboard.writeText(dummy.value)
        document.body.removeChild(dummy);
})})
