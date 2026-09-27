(function () {
  "use strict";

  window.MscSaveEditorContract = {
    version: "global-v1-all-captains-online-settings",
    region: "GLOBAL",
    supportedRegions: ["R4QP01", "R4QE01", "R4QJ01", "R4QK01"],
    fileName: "Strikers2",
    fileSize: 35616,
    teamPresets: {
      "1": {
        captain: "Mario",
        topOffset: 139,
        bottomOffset: 143,
        backOffset: 147
      },
      "2": {
        captain: "Peach",
        topOffset: 199,
        bottomOffset: 203,
        backOffset: 207
      },
      "3": {
        captain: "DK",
        topOffset: 175,
        bottomOffset: 179,
        backOffset: 183
      },
      "4": {
        captain: "Waluigi",
        topOffset: 211,
        bottomOffset: 215,
        backOffset: 219
      },
      "5": {
        captain: "Luigi",
        topOffset: 187,
        bottomOffset: 191,
        backOffset: 195
      },
      "6": {
        captain: "Wario",
        topOffset: 223,
        bottomOffset: 227,
        backOffset: 231
      },
      "7": {
        captain: "Bowser",
        topOffset: 151,
        bottomOffset: 155,
        backOffset: 159
      },
      "8": {
        captain: "Yoshi",
        topOffset: 235,
        bottomOffset: 239,
        backOffset: 243
      },
      "9": {
        captain: "Daisy",
        topOffset: 163,
        bottomOffset: 167,
        backOffset: 171
      },
      "10": {
        captain: "Bowser Jr.",
        topOffset: 247,
        bottomOffset: 251,
        backOffset: 255
      },
      "11": {
        captain: "Diddy Kong",
        topOffset: 259,
        bottomOffset: 263,
        backOffset: 267
      },
      "12": {
        captain: "Petey",
        topOffset: 271,
        bottomOffset: 275,
        backOffset: 279
      }
    },
    valueMaps: {
      sidekicks: {
        uiToSave: {
          "1": 1,
          "2": 0,
          "3": 5,
          "4": 4,
          "5": 3,
          "6": 2,
          "7": 6,
          "8": 7
        },
        saveToUi: {
          "0": 2,
          "1": 1,
          "2": 6,
          "3": 5,
          "4": 4,
          "5": 3,
          "6": 7,
          "7": 8
        }
      }
    },
    gameSettings: {
      skillLevelOffset: 47,
      gameTypeOffset: 51,
      minutesValueOffset: 55,
      goalsValueOffset: 59,
      seriesLengthOffset: 63,
      mirroredBlocks: [
        {
          label: "online",
          skillLevelOffset: 87,
          gameTypeOffset: 91,
          minutesValueOffset: 95,
          goalsValueOffset: 99,
          seriesLengthOffset: 103,
          environmentCheatOffset: 115,
          powerUpCheatOffset: 119,
          playerCheatOffset: 123
        }
      ],
      cameraTypeOffset: 36,
      cameraValueOffset: 40,
      cameraValueFormat: "float32_be",
      environmentCheatOffset: 75,
      powerUpCheatOffset: 79,
      playerCheatOffset: 83,
      maps: {
        gameType: {
          minutes: 0,
          goals: 1
        },
        cameraType: {
          static: 0,
          dynamic: 1
        },
        environmentCheats: {
          none: 8,
          secureStadia: 0,
          fieldTilt: 3
        },
        powerUpCheats: {
          bombsAway: 0,
          none: 1,
          shells: 4
        },
        playerCheats: {
          none: 0,
          safeMegastrike: 2,
          classicMode: 4
        }
      }
    },
    integrity: {
      mode: "known",
      description: "Recalculates header CRC at bytes 0x0004-0x0007 as CRC32 over bytes 0x0008-end. Secondary header field (0x0008-0x000B) is preserved."
    },
    applyIntegrity: function applyIntegrity(bytes) {
      if (!bytes || bytes.length < 12) {
        return false;
      }

      var table = applyIntegrity._crcTable;
      if (!table) {
        table = new Uint32Array(256);
        for (var i = 0; i < 256; i += 1) {
          var c = i;
          for (var k = 0; k < 8; k += 1) {
            c = (c & 1) ? ((0xedb88320 ^ (c >>> 1)) >>> 0) : (c >>> 1);
          }
          table[i] = c >>> 0;
        }
        applyIntegrity._crcTable = table;
      }

      var crc = 0xffffffff;
      for (var offset = 8; offset < bytes.length; offset += 1) {
        crc = (table[(crc ^ bytes[offset]) & 0xff] ^ (crc >>> 8)) >>> 0;
      }
      crc = (crc ^ 0xffffffff) >>> 0;

      bytes[4] = (crc >>> 24) & 0xff;
      bytes[5] = (crc >>> 16) & 0xff;
      bytes[6] = (crc >>> 8) & 0xff;
      bytes[7] = crc & 0xff;

      return true;
    }
  };
})();
