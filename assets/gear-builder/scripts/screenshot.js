import { Slots } from "./data.js";

const CAPTURE_ADJUST = Object.freeze({
    left: 24,
    top: 14,
    right: -86,
    bottom: 10
});
const CAPTURE_BACKGROUND = "transparent";

function getCaptureContext(event) {
    var $tabPane = $(event.target).closest("div.tab-pane");
    var tabPaneEl = $tabPane.get(0);
    var cardEl = $tabPane.find(".buildcard").get(0);

    if (!tabPaneEl || !cardEl) {
        return null;
    }

    var cardId = String(cardEl.id || "");
    var cardNum = Number(cardId.replace("card", "")) - 1;
    var build = $tabPane.find("div.cardbuild").first().text().trim();

    return {
        tabPaneEl,
        cardEl,
        cardNum,
        build
    };
}

function getCaptureFrame(cardEl) {
    var cardRect = cardEl.getBoundingClientRect();
    var cardWidth = Math.max(1, Math.round(cardRect.width));
    var cardHeight = Math.max(1, Math.round(cardRect.height));

    return {
        cardWidth: cardWidth,
        cardHeight: cardHeight,
        offsetX: Math.round(CAPTURE_ADJUST.left),
        offsetY: Math.round(CAPTURE_ADJUST.top),
        width: Math.max(1, Math.round(cardRect.width + CAPTURE_ADJUST.left + CAPTURE_ADJUST.right)),
        height: Math.max(1, Math.round(cardRect.height + CAPTURE_ADJUST.top + CAPTURE_ADJUST.bottom))
    };
}

function removeElement(element) {
    if (element && element.parentNode) {
        element.parentNode.removeChild(element);
    }
}

function stripIds(node) {
    if (!node || node.nodeType !== 1) {
        return;
    }

    node.removeAttribute("id");
    var idNodes = node.querySelectorAll("[id]");
    for (var i = 0; i < idNodes.length; i += 1) {
        idNodes[i].removeAttribute("id");
    }
}

function createCaptureNode(context, frame) {
    var captureNode = document.createElement("div");
    captureNode.setAttribute("data-msbl-capture", "true");
    captureNode.style.position = "absolute";
    captureNode.style.left = "-100000px";
    captureNode.style.top = "0";
    captureNode.style.width = String(frame.width) + "px";
    captureNode.style.height = String(frame.height) + "px";
    captureNode.style.overflow = "hidden";
    captureNode.style.boxSizing = "border-box";
    captureNode.style.backgroundColor = CAPTURE_BACKGROUND;
    captureNode.style.pointerEvents = "none";

    var clone = context.cardEl.cloneNode(true);
    stripIds(clone);

    clone.style.position = "absolute";
    clone.style.left = String(frame.offsetX) + "px";
    clone.style.top = String(frame.offsetY) + "px";
    clone.style.margin = "0";
    clone.style.width = String(frame.cardWidth) + "px";
    clone.style.maxWidth = "none";
    clone.style.height = String(frame.cardHeight) + "px";
    clone.style.maxHeight = "none";
    clone.style.overflow = "visible";

    captureNode.appendChild(clone);
    context.tabPaneEl.appendChild(captureNode);
    return captureNode;
}

function renderCardCanvas(event) {
    var context = getCaptureContext(event);

    if (!context) {
        return Promise.reject(new Error("No capture target found."));
    }

    if (typeof html2canvas !== "function") {
        return Promise.reject(new Error("html2canvas is not available."));
    }

    var frame = getCaptureFrame(context.cardEl);
    var captureNode = createCaptureNode(context, frame);

    return html2canvas(captureNode, {
        backgroundColor: null,
        logging: false
    }).then(function(canvas) {
        removeElement(captureNode);
        return { canvas: canvas, context: context };
    }, function(error) {
        removeElement(captureNode);
        throw error;
    });
}

$(document).ready(function() {
    $('.copypic').click(function(e) {
    renderCardCanvas(e).then(({ canvas }) => {
        canvas.toBlob(blob => {
            if (!blob) return;
            navigator.clipboard.write([new ClipboardItem({'image/png': blob})]);
        });
    });
})})


$(document).ready(function() {
    $('.savepic').click(function(e) {
    renderCardCanvas(e).then(({ canvas, context }) => {
        var cardname = Slots.find(k=>k.num==context.cardNum)?.char;
        canvas.toBlob(blob => {
            if (!blob) return;
            window.saveAs(blob, String(cardname)+' ('+String(context.build)+')');
        });
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
