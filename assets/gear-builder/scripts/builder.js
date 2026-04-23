let Builds = [];

async function loadBuilds() {
  try {
    const buildsUrl = new URL("../builds.json", import.meta.url).href;
    const res = await fetch(buildsUrl);
    Builds = await res.json();
    document.querySelector(".submit").disabled = false;
  } catch (err) {
    // silently fail or re-enable the button anyway
    console.error("Failed to load builds:", err);
  }
}

loadBuilds();

$(document).ready(function () {
    $(".submit").on('pointerup', function (e) {
        e.preventDefault(); // prevent default form behavior (especially on mobile)

        const btable = document.getElementById("table-b").getElementsByTagName("tbody")[0];
        $("#table-b tbody tr").remove();

        const checks = document.querySelectorAll('input[type=checkbox]:checked');
        const checked = Array.from(checks).map(checkbox => checkbox.value);
        const resultinput = document.getElementById("results");

        const strmin = document.getElementById("range1").value;
        const strmax = document.getElementById("range2").value;
        const spdmin = document.getElementById("range3").value;
        const spdmax = document.getElementById("range4").value;
        const shotmin = document.getElementById("range5").value;
        const shotmax = document.getElementById("range6").value;
        const passmin = document.getElementById("range7").value;
        const passmax = document.getElementById("range8").value;
        const techmin = document.getElementById("range9").value;
        const techmax = document.getElementById("range10").value;

        const tabledata = Builds.filter(a =>
            checked.includes(a.Char) &&
            Number(a.Str) >= strmin && Number(a.Str) <= strmax &&
            Number(a.Spd) >= spdmin && Number(a.Spd) <= spdmax &&
            Number(a.Shot) >= shotmin && Number(a.Shot) <= shotmax &&
            Number(a.Pass) >= passmin && Number(a.Pass) <= passmax &&
            Number(a.Tech) >= techmin && Number(a.Tech) <= techmax
        );

        const MAX_ROWS = 50;
        const shownData = tabledata.slice(0, MAX_ROWS);

        resultinput.innerText = tabledata.length === 0
            ? "No results found."
            : `Showing ${shownData.length} of ${tabledata.length} results`;

        shownData.forEach(build => {
            const tr = btable.insertRow(-1);

            let td = tr.insertCell();
            td.className = "addcell";
            td.innerHTML = build.Char;

            td = tr.insertCell();
            td.className = "addcell";
            td.innerHTML = build.Gear;

            td = tr.insertCell();
            td.className = "copycell";
            td.innerHTML = build.Str;

            td = tr.insertCell();
            td.className = "copycell";
            td.innerHTML = build.Spd;

            td = tr.insertCell();
            td.className = "copycell";
            td.innerHTML = build.Shot;

            td = tr.insertCell();
            td.className = "copycell";
            td.innerHTML = build.Pass;

            td = tr.insertCell();
            td.className = "copycell";
            td.innerHTML = build.Tech;
        });
    });
})
