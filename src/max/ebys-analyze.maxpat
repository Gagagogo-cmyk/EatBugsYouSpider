{
    "patcher": {
        "fileversion": 1,
        "appversion": {
            "major": 9,
            "minor": 1,
            "revision": 4,
            "architecture": "x64",
            "modernui": 1
        },
        "classnamespace": "box",
        "rect": [ 36.0, 105.0, 1262.0, 881.0 ],
        "boxes": [
            {
                "box": {
                    "fontface": 1,
                    "id": "obj-178",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 134.0, 773.0, 192.40506076812744, 20.0 ],
                    "text": "== BUFFER MANAGER =="
                }
            },
            {
                "box": {
                    "id": "obj-160",
                    "lastchannelcount": 0,
                    "maxclass": "live.gain~",
                    "numinlets": 2,
                    "numoutlets": 5,
                    "outlettype": [ "signal", "signal", "", "float", "list" ],
                    "parameter_enable": 1,
                    "patching_rect": [ 1220.0, 3246.0, 48.0, 136.0 ],
                    "saved_attribute_attributes": {
                        "valueof": {
                            "parameter_longname": "live.gain~[5]",
                            "parameter_mmax": 6.0,
                            "parameter_mmin": -70.0,
                            "parameter_modmode": 3,
                            "parameter_shortname": "live.gain~",
                            "parameter_type": 0,
                            "parameter_unitstyle": 4
                        }
                    },
                    "varname": "live.gain~[5]"
                }
            },
            {
                "box": {
                    "id": "obj-159",
                    "lastchannelcount": 0,
                    "maxclass": "live.gain~",
                    "numinlets": 2,
                    "numoutlets": 5,
                    "outlettype": [ "signal", "signal", "", "float", "list" ],
                    "parameter_enable": 1,
                    "patching_rect": [ 1144.0, 3246.0, 48.0, 136.0 ],
                    "saved_attribute_attributes": {
                        "valueof": {
                            "parameter_longname": "live.gain~[4]",
                            "parameter_mmax": 6.0,
                            "parameter_mmin": -70.0,
                            "parameter_modmode": 3,
                            "parameter_shortname": "live.gain~",
                            "parameter_type": 0,
                            "parameter_unitstyle": 4
                        }
                    },
                    "varname": "live.gain~[4]"
                }
            },
            {
                "box": {
                    "id": "obj-111",
                    "lastchannelcount": 0,
                    "maxclass": "live.gain~",
                    "numinlets": 2,
                    "numoutlets": 5,
                    "outlettype": [ "signal", "signal", "", "float", "list" ],
                    "parameter_enable": 1,
                    "patching_rect": [ 1070.0, 3484.0, 48.0, 136.0 ],
                    "saved_attribute_attributes": {
                        "valueof": {
                            "parameter_longname": "live.gain~[3]",
                            "parameter_mmax": 6.0,
                            "parameter_mmin": -70.0,
                            "parameter_modmode": 3,
                            "parameter_shortname": "live.gain~",
                            "parameter_type": 0,
                            "parameter_unitstyle": 4
                        }
                    },
                    "varname": "live.gain~[3]"
                }
            },
            {
                "box": {
                    "id": "obj-76",
                    "lastchannelcount": 0,
                    "maxclass": "live.gain~",
                    "numinlets": 2,
                    "numoutlets": 5,
                    "outlettype": [ "signal", "signal", "", "float", "list" ],
                    "parameter_enable": 1,
                    "patching_rect": [ 1164.0, 3484.0, 48.0, 136.0 ],
                    "saved_attribute_attributes": {
                        "valueof": {
                            "parameter_longname": "live.gain~[2]",
                            "parameter_mmax": 6.0,
                            "parameter_mmin": -70.0,
                            "parameter_modmode": 3,
                            "parameter_shortname": "live.gain~",
                            "parameter_type": 0,
                            "parameter_unitstyle": 4
                        }
                    },
                    "varname": "live.gain~[2]"
                }
            },
            {
                "box": {
                    "id": "obj-66",
                    "lastchannelcount": 0,
                    "maxclass": "live.gain~",
                    "numinlets": 2,
                    "numoutlets": 5,
                    "outlettype": [ "signal", "signal", "", "float", "list" ],
                    "parameter_enable": 1,
                    "patching_rect": [ 1246.0, 3484.0, 48.0, 136.0 ],
                    "saved_attribute_attributes": {
                        "valueof": {
                            "parameter_longname": "live.gain~[1]",
                            "parameter_mmax": 6.0,
                            "parameter_mmin": -70.0,
                            "parameter_modmode": 3,
                            "parameter_shortname": "live.gain~",
                            "parameter_type": 0,
                            "parameter_unitstyle": 4
                        }
                    },
                    "varname": "live.gain~[1]"
                }
            },
            {
                "box": {
                    "id": "obj-65",
                    "lastchannelcount": 0,
                    "maxclass": "live.gain~",
                    "numinlets": 2,
                    "numoutlets": 5,
                    "outlettype": [ "signal", "signal", "", "float", "list" ],
                    "parameter_enable": 1,
                    "patching_rect": [ 1336.0, 3484.0, 48.0, 136.0 ],
                    "saved_attribute_attributes": {
                        "valueof": {
                            "parameter_longname": "live.gain~",
                            "parameter_mmax": 6.0,
                            "parameter_mmin": -70.0,
                            "parameter_modmode": 3,
                            "parameter_shortname": "live.gain~",
                            "parameter_type": 0,
                            "parameter_unitstyle": 4
                        }
                    },
                    "varname": "live.gain~"
                }
            },
            {
                "box": {
                    "fontface": 1,
                    "fontsize": 12.0,
                    "id": "obj-64",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 2012.0, 2606.0, 130.6666705608368, 20.0 ],
                    "text": "MASTER VU METER",
                    "textcolor": [ 1.0, 1.0, 1.0, 1.0 ]
                }
            },
            {
                "box": {
                    "fontface": 1,
                    "fontsize": 12.0,
                    "id": "obj-49",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 130.0, 2770.0, 121.09129738807678, 20.0 ],
                    "text": "== VU METERS ==",
                    "textcolor": [ 1.0, 1.0, 1.0, 1.0 ]
                }
            },
            {
                "box": {
                    "fontface": 1,
                    "id": "obj-45",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 136.0, 1041.0, 138.0, 20.0 ],
                    "text": "== SLOT ROUTER ==",
                    "textcolor": [ 1.0, 1.0, 1.0, 1.0 ]
                }
            },
            {
                "box": {
                    "fontface": 1,
                    "id": "obj-194",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 2539.3616839647293, 84.04255259037018, 113.83333672583103, 20.0 ],
                    "text": "== ANALYSIS =="
                }
            },
            {
                "box": {
                    "fontface": 1,
                    "id": "obj-2",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5095.575631260872, 84.95575904846191, 155.55556797981262, 20.0 ],
                    "text": "== TUI COMMANDS =="
                }
            },
            {
                "box": {
                    "id": "obj-26",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 5267.122904658318, 157.53423511981964, 63.0, 22.0 ],
                    "text": "script stop"
                }
            },
            {
                "box": {
                    "id": "obj-187",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "patching_rect": [ 1340.0, 1408.0, 67.0, 22.0 ],
                    "text": "delay 1000"
                }
            },
            {
                "box": {
                    "id": "obj-163",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 1398.0, 1340.0, 31.0, 22.0 ],
                    "text": "play"
                }
            },
            {
                "box": {
                    "id": "obj-164",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 1502.0, 1340.0, 31.0, 22.0 ],
                    "text": "stop"
                }
            },
            {
                "box": {
                    "id": "obj-165",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 1434.0, 1340.0, 67.0, 22.0 ],
                    "text": "0."
                }
            },
            {
                "box": {
                    "id": "obj-172",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 3,
                    "outlettype": [ "bang", "bang", "float" ],
                    "patching_rect": [ 1434.0, 1288.0, 40.0, 22.0 ],
                    "text": "t b b f"
                }
            },
            {
                "box": {
                    "id": "obj-63",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "patching_rect": [ 1958.0, 1408.0, 67.0, 22.0 ],
                    "text": "delay 1000"
                }
            },
            {
                "box": {
                    "id": "obj-58",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 1958.0, 1340.0, 31.0, 22.0 ],
                    "text": "play"
                }
            },
            {
                "box": {
                    "id": "obj-59",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2088.0, 1340.0, 31.0, 22.0 ],
                    "text": "stop"
                }
            },
            {
                "box": {
                    "id": "obj-60",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2006.0, 1340.0, 67.0, 22.0 ],
                    "text": "0."
                }
            },
            {
                "box": {
                    "id": "obj-61",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 3,
                    "outlettype": [ "bang", "bang", "float" ],
                    "patching_rect": [ 2020.0, 1288.0, 40.0, 22.0 ],
                    "text": "t b b f"
                }
            },
            {
                "box": {
                    "id": "obj-55",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 806.0, 1340.0, 31.0, 22.0 ],
                    "text": "play"
                }
            },
            {
                "box": {
                    "id": "obj-56",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 912.0, 1340.0, 31.0, 22.0 ],
                    "text": "stop"
                }
            },
            {
                "box": {
                    "id": "obj-57",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 836.0, 1340.0, 67.0, 22.0 ],
                    "text": "0."
                }
            },
            {
                "box": {
                    "id": "obj-54",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 3,
                    "outlettype": [ "bang", "bang", "float" ],
                    "patching_rect": [ 858.0, 1284.0, 40.0, 22.0 ],
                    "text": "t b b f"
                }
            },
            {
                "box": {
                    "id": "obj-53",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "patching_rect": [ 744.0, 1408.0, 67.0, 22.0 ],
                    "text": "delay 1000"
                }
            },
            {
                "box": {
                    "id": "obj-44",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 244.0, 1340.0, 31.0, 22.0 ],
                    "text": "play"
                }
            },
            {
                "box": {
                    "id": "obj-43",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 344.0, 1340.0, 31.0, 22.0 ],
                    "text": "stop"
                }
            },
            {
                "box": {
                    "id": "obj-37",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 274.0, 1340.0, 67.0, 22.0 ],
                    "text": "0."
                }
            },
            {
                "box": {
                    "id": "obj-28",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "patching_rect": [ 168.0, 1408.0, 67.0, 22.0 ],
                    "text": "delay 1000"
                }
            },
            {
                "box": {
                    "id": "obj-25",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 3,
                    "outlettype": [ "bang", "bang", "float" ],
                    "patching_rect": [ 274.0, 1288.0, 40.0, 22.0 ],
                    "text": "t b b f"
                }
            },
            {
                "box": {
                    "id": "obj-23",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 1340.0, 1474.0, 60.0, 22.0 ],
                    "text": "next bass"
                }
            },
            {
                "box": {
                    "id": "obj-17",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 965.5172920227051, 231.03449487686157, 63.0, 22.0 ],
                    "text": "script stop"
                }
            },
            {
                "box": {
                    "id": "obj-18",
                    "maxclass": "button",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 300.0000157356262, 151.72414588928223, 24.0, 24.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-7",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 965.5172920227051, 189.65518236160278, 64.0, 22.0 ],
                    "text": "script start"
                }
            },
            {
                "box": {
                    "id": "obj-4",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "bang", "float" ],
                    "patching_rect": [ 824.1379742622375, 144.82759380340576, 29.5, 22.0 ],
                    "text": "t b f"
                }
            },
            {
                "box": {
                    "id": "obj-50",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 886.2069430351257, 144.82759380340576, 55.0, 22.0 ],
                    "text": "reset NA"
                }
            },
            {
                "box": {
                    "id": "obj-158",
                    "maxclass": "button",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 4535.106350541115, 2741.4893420934677, 24.0, 24.0 ]
                }
            },
            {
                "box": {
                    "filename": "fluid.waveform~",
                    "id": "obj-123",
                    "maxclass": "jsui",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 4535.106350541115, 2960.638276696205, 336.0, 109.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-124",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "bang", "bang" ],
                    "patching_rect": [ 4535.106350541115, 2860.638277411461, 32.0, 22.0 ],
                    "text": "t b b"
                }
            },
            {
                "box": {
                    "id": "obj-125",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 4793.616986989975, 2903.1914685964584, 245.0, 22.0 ],
                    "text": "clear, addlayer audiobuffer stem_melo.mono"
                }
            },
            {
                "box": {
                    "id": "obj-126",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 4535.106350541115, 2903.1914685964584, 213.0, 22.0 ],
                    "text": "features stem_melo_mfcc.features red"
                }
            },
            {
                "box": {
                    "id": "obj-156",
                    "linecount": 2,
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 4535.106350541115, 2787.23402261734, 360.17387294769287, 35.0 ],
                    "text": "fluid.bufmfcc~ @source stem_melo.mono @features stem_melo_mfcc.features @numcoeffs 13 @numbands 40"
                }
            },
            {
                "box": {
                    "id": "obj-122",
                    "maxclass": "button",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 3870.212738275528, 2741.4893420934677, 24.0, 24.0 ]
                }
            },
            {
                "box": {
                    "filename": "fluid.waveform~",
                    "id": "obj-114",
                    "maxclass": "jsui",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 3870.212738275528, 2960.638276696205, 336.0, 109.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-116",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "bang", "bang" ],
                    "patching_rect": [ 3870.212738275528, 2860.638277411461, 32.0, 22.0 ],
                    "text": "t b b"
                }
            },
            {
                "box": {
                    "id": "obj-119",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 4124.468055605888, 2903.1914685964584, 244.0, 22.0 ],
                    "text": "clear, addlayer audiobuffer stem_bass.mono"
                }
            },
            {
                "box": {
                    "id": "obj-120",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 3870.212738275528, 2903.1914685964584, 213.0, 22.0 ],
                    "text": "features stem_bass_mfcc.features red"
                }
            },
            {
                "box": {
                    "id": "obj-121",
                    "linecount": 2,
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 3870.212738275528, 2787.23402261734, 341.0, 35.0 ],
                    "text": "fluid.bufmfcc~ @source stem_bass.mono @features stem_bass_mfcc.features @numcoeffs 13 @numbands 40"
                }
            },
            {
                "box": {
                    "id": "obj-109",
                    "maxclass": "button",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 3185.1063601970673, 2734.042533636093, 24.0, 24.0 ]
                }
            },
            {
                "box": {
                    "filename": "fluid.waveform~",
                    "id": "obj-94",
                    "maxclass": "jsui",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 3185.1063601970673, 2960.638276696205, 336.0, 109.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-98",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "bang", "bang" ],
                    "patching_rect": [ 3185.1063601970673, 2860.638277411461, 32.0, 22.0 ],
                    "text": "t b b"
                }
            },
            {
                "box": {
                    "id": "obj-101",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 3443.6169966459274, 2903.1914685964584, 252.0, 22.0 ],
                    "text": "clear, addlayer audiobuffer stem_drums.mono"
                }
            },
            {
                "box": {
                    "id": "obj-102",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 3185.1063601970673, 2903.1914685964584, 221.0, 22.0 ],
                    "text": "features stem_drums_mfcc.features red"
                }
            },
            {
                "box": {
                    "id": "obj-105",
                    "linecount": 2,
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 3185.1063601970673, 2787.23402261734, 348.56519985198975, 35.0 ],
                    "text": "fluid.bufmfcc~ @source stem_drums.mono @features stem_drums_mfcc.features @numcoeffs 13 @numbands 40"
                }
            },
            {
                "box": {
                    "filename": "fluid.waveform~",
                    "id": "obj-93",
                    "maxclass": "jsui",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 2570.2127475738525, 2960.638276696205, 336.0, 109.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-86",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "bang", "bang" ],
                    "patching_rect": [ 2570.2127475738525, 2860.638277411461, 32.0, 22.0 ],
                    "text": "t b b"
                }
            },
            {
                "box": {
                    "id": "obj-87",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2824.468064904213, 2903.1914685964584, 253.0, 22.0 ],
                    "text": "clear, addlayer audiobuffer stem_vocals.mono"
                }
            },
            {
                "box": {
                    "id": "obj-91",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2570.2127475738525, 2903.1914685964584, 221.0, 22.0 ],
                    "text": "features stem_vocals_mfcc.features red"
                }
            },
            {
                "box": {
                    "id": "obj-85",
                    "maxclass": "button",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 2570.2127475738525, 2734.042533636093, 24.0, 24.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-75",
                    "linecount": 2,
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 2570.2127475738525, 2787.23402261734, 346.39129734039307, 35.0 ],
                    "text": "fluid.bufmfcc~ @source stem_vocals.mono @features stem_vocals_mfcc.features @numcoeffs 13 @numbands 40"
                }
            },
            {
                "box": {
                    "color": [ 1.0, 0.0, 0.0, 1.0 ],
                    "id": "obj-74",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 4739.361668229103, 395.7446780204773, 187.0, 22.0 ],
                    "text": "buffer~ stem_melo_mfcc.features"
                }
            },
            {
                "box": {
                    "color": [ 1.0, 0.0, 0.0, 1.0 ],
                    "id": "obj-73",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 4024.468056321144, 395.7446780204773, 186.0, 22.0 ],
                    "text": "buffer~ stem_bass_mfcc.features"
                }
            },
            {
                "box": {
                    "color": [ 1.0, 0.0, 0.0, 1.0 ],
                    "id": "obj-72",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 3358.5106142759323, 391.48935890197754, 194.0, 22.0 ],
                    "text": "buffer~ stem_drums_mfcc.features"
                }
            },
            {
                "box": {
                    "color": [ 1.0, 0.0, 0.0, 1.0 ],
                    "id": "obj-67",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 2755.319129228592, 391.48935890197754, 195.0, 22.0 ],
                    "text": "buffer~ stem_vocals_mfcc.features"
                }
            },
            {
                "box": {
                    "id": "obj-435",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "bang", "bang" ],
                    "patching_rect": [ 4562.765924811363, 803.1914836168289, 32.0, 22.0 ],
                    "text": "t b b"
                }
            },
            {
                "box": {
                    "id": "obj-430",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "bang", "bang" ],
                    "patching_rect": [ 3896.8084827661514, 803.1914836168289, 32.0, 22.0 ],
                    "text": "t b b"
                }
            },
            {
                "box": {
                    "id": "obj-429",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "bang", "bang" ],
                    "patching_rect": [ 3215.9574238061905, 803.1914836168289, 32.0, 22.0 ],
                    "text": "t b b"
                }
            },
            {
                "box": {
                    "id": "obj-426",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "patching_rect": [ 2565.957428455353, 568.0851023197174, 22.0, 22.0 ],
                    "text": "t b"
                }
            },
            {
                "box": {
                    "id": "obj-425",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "bang", "bang" ],
                    "patching_rect": [ 4535.106350541115, 2391.489344596863, 32.0, 22.0 ],
                    "text": "t b b"
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-407",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 4855.319114208221, 2695.7446615695953, 25.0, 20.0 ],
                    "text": "G#",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-408",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 4827.659539937973, 2695.7446615695953, 19.0, 20.0 ],
                    "text": "G",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-409",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 4805.319114565849, 2695.7446615695953, 23.0, 20.0 ],
                    "text": "F#",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-414",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 4770.212731838226, 2695.7446615695953, 19.0, 20.0 ],
                    "text": "F",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-415",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 4746.808476686478, 2695.7446615695953, 19.0, 20.0 ],
                    "text": "E",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-416",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 4712.76592373848, 2695.7446615695953, 24.0, 20.0 ],
                    "text": "D#",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-417",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 4681.914860129356, 2695.7446615695953, 19.0, 20.0 ],
                    "text": "D",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-418",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 4651.063796520233, 2695.7446615695953, 24.0, 20.0 ],
                    "text": "C#",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-419",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 4624.46805202961, 2695.7446615695953, 19.0, 20.0 ],
                    "text": "C",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-420",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 4596.808477759361, 2695.7446615695953, 19.0, 20.0 ],
                    "text": "B",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-421",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 4565.957414150238, 2695.7446615695953, 23.0, 20.0 ],
                    "text": "A#",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-422",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 4539.361669659615, 2695.7446615695953, 19.0, 20.0 ],
                    "text": "A",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "candycane": 12,
                    "ghostbar": 100,
                    "id": "obj-423",
                    "ignoreclick": 1,
                    "maxclass": "multislider",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 4535.106350541115, 2618.085087656975, 348.0, 77.0 ],
                    "presentation": 1,
                    "presentation_rect": [ 1777.3809354305267, 3085.714256286621, 425.0, 156.0 ],
                    "setminmax": [ 0.0, 0.20000000298023224 ],
                    "size": 12
                }
            },
            {
                "box": {
                    "id": "obj-424",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patcher": {
                        "fileversion": 1,
                        "appversion": {
                            "major": 9,
                            "minor": 1,
                            "revision": 4,
                            "architecture": "x64",
                            "modernui": 1
                        },
                        "classnamespace": "box",
                        "rect": [ 84.0, 131.0, 421.0, 591.0 ],
                        "boxes": [
                            {
                                "box": {
                                    "id": "obj-65",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "bang", "int" ],
                                    "patching_rect": [ 233.0, 348.0, 29.5, 22.0 ],
                                    "text": "t b i"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-61",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 2,
                                    "outlettype": [ "", "" ],
                                    "patching_rect": [ 125.5, 468.0, 51.0, 22.0 ],
                                    "text": "zl.group"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-60",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 1,
                                    "outlettype": [ "int" ],
                                    "patching_rect": [ 233.0, 398.0, 29.5, 22.0 ],
                                    "text": "int"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-59",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "bang", "int" ],
                                    "patching_rect": [ 18.0, 262.0, 90.0, 22.0 ],
                                    "text": "t b i"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-58",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 3,
                                    "outlettype": [ "bang", "bang", "int" ],
                                    "patching_rect": [ 18.0, 308.0, 234.0, 22.0 ],
                                    "text": "uzi 12"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-55",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 1,
                                    "outlettype": [ "" ],
                                    "patching_rect": [ 18.0, 228.0, 39.0, 22.0 ],
                                    "text": "round"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-52",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "float", "bang" ],
                                    "patching_rect": [ 18.0, 108.0, 49.0, 22.0 ],
                                    "text": "t f b"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-51",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 1,
                                    "outlettype": [ "float" ],
                                    "patching_rect": [ 18.0, 188.0, 49.0, 22.0 ],
                                    "text": "* 1."
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-43",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 3,
                                    "outlettype": [ "", "", "" ],
                                    "patching_rect": [ 48.0, 158.0, 135.0, 22.0 ],
                                    "text": "getattr samps @listen 0"
                                }
                            },
                            {
                                "box": {
                                    "color": [ 1.0, 0.43921568627451, 0.662745098039216, 1.0 ],
                                    "id": "obj-42",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "float", "bang" ],
                                    "patching_rect": [ 106.0, 188.0, 201.0, 22.0 ],
                                    "text": "buffer~ stem_melo_chroma.features"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-37",
                                    "maxclass": "newobj",
                                    "numinlets": 3,
                                    "numoutlets": 1,
                                    "outlettype": [ "float" ],
                                    "patching_rect": [ 233.0, 428.0, 204.0, 22.0 ],
                                    "text": "peek~ stem_melo_chroma.features"
                                }
                            },
                            {
                                "box": {
                                    "format": 6,
                                    "id": "obj-27",
                                    "maxclass": "flonum",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "", "bang" ],
                                    "parameter_enable": 0,
                                    "patching_rect": [ 18.0, 68.0, 50.0, 22.0 ]
                                }
                            },
                            {
                                "box": {
                                    "comment": "",
                                    "id": "obj-67",
                                    "index": 1,
                                    "maxclass": "inlet",
                                    "numinlets": 0,
                                    "numoutlets": 1,
                                    "outlettype": [ "" ],
                                    "patching_rect": [ 18.0, 8.0, 30.0, 30.0 ]
                                }
                            },
                            {
                                "box": {
                                    "comment": "",
                                    "id": "obj-68",
                                    "index": 1,
                                    "maxclass": "outlet",
                                    "numinlets": 1,
                                    "numoutlets": 0,
                                    "patching_rect": [ 125.5, 550.0, 30.0, 30.0 ]
                                }
                            }
                        ],
                        "lines": [
                            {
                                "patchline": {
                                    "destination": [ "obj-52", 0 ],
                                    "source": [ "obj-27", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-61", 0 ],
                                    "midpoints": [ 242.5, 458.359375, 135.0, 458.359375 ],
                                    "source": [ "obj-37", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-42", 0 ],
                                    "source": [ "obj-43", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-51", 1 ],
                                    "source": [ "obj-43", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-55", 0 ],
                                    "source": [ "obj-51", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-43", 0 ],
                                    "source": [ "obj-52", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-51", 0 ],
                                    "source": [ "obj-52", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-59", 0 ],
                                    "source": [ "obj-55", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-61", 0 ],
                                    "source": [ "obj-58", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-65", 0 ],
                                    "source": [ "obj-58", 2 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-58", 0 ],
                                    "source": [ "obj-59", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-60", 1 ],
                                    "midpoints": [ 98.5, 295.0, 272.0, 295.0, 272.0, 385.0, 253.0, 385.0 ],
                                    "source": [ "obj-59", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-37", 0 ],
                                    "source": [ "obj-60", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-68", 0 ],
                                    "source": [ "obj-61", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-37", 2 ],
                                    "midpoints": [ 253.0, 385.0, 427.5, 385.0 ],
                                    "source": [ "obj-65", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-60", 0 ],
                                    "midpoints": [ 242.5, 373.0, 242.5, 373.0 ],
                                    "source": [ "obj-65", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-27", 0 ],
                                    "source": [ "obj-67", 0 ]
                                }
                            }
                        ]
                    },
                    "patching_rect": [ 4535.106350541115, 2572.3404071331024, 103.0, 22.0 ],
                    "text": "p \"feature lookup\""
                }
            },
            {
                "box": {
                    "bgcolor": [ 0.2, 0.2, 0.2, 0.0 ],
                    "contdata": 1,
                    "id": "obj-405",
                    "maxclass": "multislider",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "orientation": 0,
                    "outlettype": [ "", "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 4535.106350541115, 2472.340407848358, 304.0, 85.0 ],
                    "setminmax": [ 0.0, 1.0 ],
                    "slidercolor": [ 1.0, 0.792156862745098, 0.0, 1.0 ]
                }
            },
            {
                "box": {
                    "filename": "fluid.waveform~",
                    "id": "obj-406",
                    "maxclass": "jsui",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 4535.106350541115, 2472.340407848358, 304.0, 85.0 ]
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-391",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 4196.808480620384, 2695.7446615695953, 25.0, 20.0 ],
                    "text": "G#",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-392",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 4170.212736129761, 2695.7446615695953, 19.0, 20.0 ],
                    "text": "G",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-393",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 4146.808480978012, 2695.7446615695953, 23.0, 20.0 ],
                    "text": "F#",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-394",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 4120.212736487389, 2695.7446615695953, 19.0, 20.0 ],
                    "text": "F",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-395",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 4085.1063537597656, 2695.7446615695953, 19.0, 20.0 ],
                    "text": "E",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-396",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 4058.510609269142, 2695.7446615695953, 24.0, 20.0 ],
                    "text": "D#",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-397",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 4027.659545660019, 2695.7446615695953, 19.0, 20.0 ],
                    "text": "D",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-398",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 3996.8084820508957, 2695.7446615695953, 24.0, 20.0 ],
                    "text": "C#",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-399",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 3965.9574184417725, 2695.7446615695953, 19.0, 20.0 ],
                    "text": "C",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-401",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 3939.361673951149, 2695.7446615695953, 19.0, 20.0 ],
                    "text": "B",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-402",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 3908.5106103420258, 2695.7446615695953, 23.0, 20.0 ],
                    "text": "A#",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-403",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 3881.9148658514023, 2695.7446615695953, 19.0, 20.0 ],
                    "text": "A",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "candycane": 12,
                    "ghostbar": 100,
                    "id": "obj-404",
                    "ignoreclick": 1,
                    "maxclass": "multislider",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 3877.6595467329025, 2618.085087656975, 348.0, 77.0 ],
                    "presentation": 1,
                    "presentation_rect": [ 1201.1904647350311, 3085.714256286621, 425.0, 156.0 ],
                    "setminmax": [ 0.0, 0.20000000298023224 ],
                    "size": 12
                }
            },
            {
                "box": {
                    "id": "obj-389",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patcher": {
                        "fileversion": 1,
                        "appversion": {
                            "major": 9,
                            "minor": 1,
                            "revision": 4,
                            "architecture": "x64",
                            "modernui": 1
                        },
                        "classnamespace": "box",
                        "rect": [ 84.0, 131.0, 421.0, 591.0 ],
                        "boxes": [
                            {
                                "box": {
                                    "id": "obj-65",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "bang", "int" ],
                                    "patching_rect": [ 233.0, 348.0, 29.5, 22.0 ],
                                    "text": "t b i"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-61",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 2,
                                    "outlettype": [ "", "" ],
                                    "patching_rect": [ 125.5, 468.0, 51.0, 22.0 ],
                                    "text": "zl.group"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-60",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 1,
                                    "outlettype": [ "int" ],
                                    "patching_rect": [ 233.0, 398.0, 29.5, 22.0 ],
                                    "text": "int"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-59",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "bang", "int" ],
                                    "patching_rect": [ 18.0, 262.0, 90.0, 22.0 ],
                                    "text": "t b i"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-58",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 3,
                                    "outlettype": [ "bang", "bang", "int" ],
                                    "patching_rect": [ 18.0, 308.0, 234.0, 22.0 ],
                                    "text": "uzi 12"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-55",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 1,
                                    "outlettype": [ "" ],
                                    "patching_rect": [ 18.0, 228.0, 39.0, 22.0 ],
                                    "text": "round"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-52",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "float", "bang" ],
                                    "patching_rect": [ 18.0, 108.0, 49.0, 22.0 ],
                                    "text": "t f b"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-51",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 1,
                                    "outlettype": [ "float" ],
                                    "patching_rect": [ 18.0, 188.0, 49.0, 22.0 ],
                                    "text": "* 1."
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-43",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 3,
                                    "outlettype": [ "", "", "" ],
                                    "patching_rect": [ 48.0, 158.0, 135.0, 22.0 ],
                                    "text": "getattr samps @listen 0"
                                }
                            },
                            {
                                "box": {
                                    "color": [ 1.0, 0.43921568627451, 0.662745098039216, 1.0 ],
                                    "id": "obj-42",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "float", "bang" ],
                                    "patching_rect": [ 106.0, 188.0, 201.0, 22.0 ],
                                    "text": "buffer~ stem_bass_chroma.features"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-37",
                                    "maxclass": "newobj",
                                    "numinlets": 3,
                                    "numoutlets": 1,
                                    "outlettype": [ "float" ],
                                    "patching_rect": [ 233.0, 428.0, 196.0, 22.0 ],
                                    "text": "peek~ stem_bass_chroma.features"
                                }
                            },
                            {
                                "box": {
                                    "format": 6,
                                    "id": "obj-27",
                                    "maxclass": "flonum",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "", "bang" ],
                                    "parameter_enable": 0,
                                    "patching_rect": [ 18.0, 68.0, 50.0, 22.0 ]
                                }
                            },
                            {
                                "box": {
                                    "comment": "",
                                    "id": "obj-67",
                                    "index": 1,
                                    "maxclass": "inlet",
                                    "numinlets": 0,
                                    "numoutlets": 1,
                                    "outlettype": [ "" ],
                                    "patching_rect": [ 18.0, 8.0, 30.0, 30.0 ]
                                }
                            },
                            {
                                "box": {
                                    "comment": "",
                                    "id": "obj-68",
                                    "index": 1,
                                    "maxclass": "outlet",
                                    "numinlets": 1,
                                    "numoutlets": 0,
                                    "patching_rect": [ 125.5, 550.0, 30.0, 30.0 ]
                                }
                            }
                        ],
                        "lines": [
                            {
                                "patchline": {
                                    "destination": [ "obj-52", 0 ],
                                    "source": [ "obj-27", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-61", 0 ],
                                    "midpoints": [ 242.5, 451.0, 135.0, 451.0 ],
                                    "source": [ "obj-37", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-42", 0 ],
                                    "source": [ "obj-43", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-51", 1 ],
                                    "source": [ "obj-43", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-55", 0 ],
                                    "source": [ "obj-51", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-43", 0 ],
                                    "source": [ "obj-52", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-51", 0 ],
                                    "source": [ "obj-52", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-59", 0 ],
                                    "source": [ "obj-55", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-61", 0 ],
                                    "source": [ "obj-58", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-65", 0 ],
                                    "source": [ "obj-58", 2 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-58", 0 ],
                                    "source": [ "obj-59", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-60", 1 ],
                                    "midpoints": [ 98.5, 295.0, 272.0, 295.0, 272.0, 385.0, 253.0, 385.0 ],
                                    "source": [ "obj-59", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-37", 0 ],
                                    "source": [ "obj-60", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-68", 0 ],
                                    "source": [ "obj-61", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-37", 2 ],
                                    "midpoints": [ 253.0, 385.0, 419.5, 385.0 ],
                                    "source": [ "obj-65", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-60", 0 ],
                                    "midpoints": [ 242.5, 373.0, 242.5, 373.0 ],
                                    "source": [ "obj-65", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-27", 0 ],
                                    "source": [ "obj-67", 0 ]
                                }
                            }
                        ]
                    },
                    "patching_rect": [ 3877.6595467329025, 2572.3404071331024, 103.0, 22.0 ],
                    "text": "p \"feature lookup\""
                }
            },
            {
                "box": {
                    "bgcolor": [ 0.2, 0.2, 0.2, 0.0 ],
                    "contdata": 1,
                    "id": "obj-387",
                    "maxclass": "multislider",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "orientation": 0,
                    "outlettype": [ "", "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 3877.6595467329025, 2472.340407848358, 304.0, 85.0 ],
                    "setminmax": [ 0.0, 1.0 ],
                    "slidercolor": [ 1.0, 0.792156862745098, 0.0, 1.0 ]
                }
            },
            {
                "box": {
                    "filename": "fluid.waveform~",
                    "id": "obj-388",
                    "maxclass": "jsui",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 3877.6595467329025, 2472.340407848358, 304.0, 85.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-386",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "bang", "bang" ],
                    "patching_rect": [ 3877.6595467329025, 2391.489344596863, 32.0, 22.0 ],
                    "text": "t b b"
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-373",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 3515.9574216604233, 2698.93615090847, 25.0, 20.0 ],
                    "text": "G#",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-374",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 3489.3616771698, 2698.93615090847, 19.0, 20.0 ],
                    "text": "G",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-375",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 3458.5106135606766, 2698.93615090847, 23.0, 20.0 ],
                    "text": "F#",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-376",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 3431.914869070053, 2698.93615090847, 19.0, 20.0 ],
                    "text": "F",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-377",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 3405.3191245794296, 2698.93615090847, 19.0, 20.0 ],
                    "text": "E",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-378",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 3374.4680609703064, 2698.93615090847, 24.0, 20.0 ],
                    "text": "D#",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-379",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 3346.808486700058, 2698.93615090847, 19.0, 20.0 ],
                    "text": "D",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-380",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 3315.9574230909348, 2698.93615090847, 24.0, 20.0 ],
                    "text": "C#",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-381",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 3281.9148701429367, 2698.93615090847, 19.0, 20.0 ],
                    "text": "C",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-382",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 3258.510614991188, 2698.93615090847, 19.0, 20.0 ],
                    "text": "B",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-383",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 3227.659551382065, 2698.93615090847, 23.0, 20.0 ],
                    "text": "A#",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-384",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 3193.6169984340668, 2698.93615090847, 19.0, 20.0 ],
                    "text": "A",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "candycane": 12,
                    "ghostbar": 100,
                    "id": "obj-385",
                    "ignoreclick": 1,
                    "maxclass": "multislider",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 3193.6169984340668, 2618.085087656975, 348.0, 77.0 ],
                    "presentation": 1,
                    "presentation_rect": [ 594.0476133823395, 3083.3333039283752, 425.0, 156.0 ],
                    "setminmax": [ 0.0, 0.20000000298023224 ],
                    "size": 12
                }
            },
            {
                "box": {
                    "id": "obj-372",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patcher": {
                        "fileversion": 1,
                        "appversion": {
                            "major": 9,
                            "minor": 1,
                            "revision": 4,
                            "architecture": "x64",
                            "modernui": 1
                        },
                        "classnamespace": "box",
                        "rect": [ 84.0, 131.0, 421.0, 591.0 ],
                        "boxes": [
                            {
                                "box": {
                                    "id": "obj-65",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "bang", "int" ],
                                    "patching_rect": [ 233.0, 348.0, 29.5, 22.0 ],
                                    "text": "t b i"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-61",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 2,
                                    "outlettype": [ "", "" ],
                                    "patching_rect": [ 125.5, 468.0, 51.0, 22.0 ],
                                    "text": "zl.group"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-60",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 1,
                                    "outlettype": [ "int" ],
                                    "patching_rect": [ 233.0, 398.0, 29.5, 22.0 ],
                                    "text": "int"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-59",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "bang", "int" ],
                                    "patching_rect": [ 18.0, 262.0, 90.0, 22.0 ],
                                    "text": "t b i"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-58",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 3,
                                    "outlettype": [ "bang", "bang", "int" ],
                                    "patching_rect": [ 18.0, 308.0, 234.0, 22.0 ],
                                    "text": "uzi 12"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-55",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 1,
                                    "outlettype": [ "" ],
                                    "patching_rect": [ 18.0, 228.0, 39.0, 22.0 ],
                                    "text": "round"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-52",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "float", "bang" ],
                                    "patching_rect": [ 18.0, 108.0, 49.0, 22.0 ],
                                    "text": "t f b"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-51",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 1,
                                    "outlettype": [ "float" ],
                                    "patching_rect": [ 18.0, 188.0, 49.0, 22.0 ],
                                    "text": "* 1."
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-43",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 3,
                                    "outlettype": [ "", "", "" ],
                                    "patching_rect": [ 48.0, 158.0, 135.0, 22.0 ],
                                    "text": "getattr samps @listen 0"
                                }
                            },
                            {
                                "box": {
                                    "color": [ 1.0, 0.43921568627451, 0.662745098039216, 1.0 ],
                                    "id": "obj-42",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "float", "bang" ],
                                    "patching_rect": [ 106.0, 188.0, 209.0, 22.0 ],
                                    "text": "buffer~ stem_drums_chroma.features"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-37",
                                    "maxclass": "newobj",
                                    "numinlets": 3,
                                    "numoutlets": 1,
                                    "outlettype": [ "float" ],
                                    "patching_rect": [ 233.0, 428.0, 204.0, 22.0 ],
                                    "text": "peek~ stem_drums_chroma.features"
                                }
                            },
                            {
                                "box": {
                                    "format": 6,
                                    "id": "obj-27",
                                    "maxclass": "flonum",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "", "bang" ],
                                    "parameter_enable": 0,
                                    "patching_rect": [ 18.0, 68.0, 50.0, 22.0 ]
                                }
                            },
                            {
                                "box": {
                                    "comment": "",
                                    "id": "obj-67",
                                    "index": 1,
                                    "maxclass": "inlet",
                                    "numinlets": 0,
                                    "numoutlets": 1,
                                    "outlettype": [ "" ],
                                    "patching_rect": [ 18.0, 8.0, 30.0, 30.0 ]
                                }
                            },
                            {
                                "box": {
                                    "comment": "",
                                    "id": "obj-68",
                                    "index": 1,
                                    "maxclass": "outlet",
                                    "numinlets": 1,
                                    "numoutlets": 0,
                                    "patching_rect": [ 125.5, 550.0, 30.0, 30.0 ]
                                }
                            }
                        ],
                        "lines": [
                            {
                                "patchline": {
                                    "destination": [ "obj-52", 0 ],
                                    "source": [ "obj-27", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-61", 0 ],
                                    "midpoints": [ 242.5, 451.0, 135.0, 451.0 ],
                                    "source": [ "obj-37", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-42", 0 ],
                                    "source": [ "obj-43", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-51", 1 ],
                                    "source": [ "obj-43", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-55", 0 ],
                                    "source": [ "obj-51", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-43", 0 ],
                                    "source": [ "obj-52", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-51", 0 ],
                                    "source": [ "obj-52", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-59", 0 ],
                                    "source": [ "obj-55", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-61", 0 ],
                                    "source": [ "obj-58", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-65", 0 ],
                                    "source": [ "obj-58", 2 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-58", 0 ],
                                    "source": [ "obj-59", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-60", 1 ],
                                    "midpoints": [ 98.5, 295.0, 272.0, 295.0, 272.0, 385.0, 253.0, 385.0 ],
                                    "source": [ "obj-59", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-37", 0 ],
                                    "source": [ "obj-60", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-68", 0 ],
                                    "source": [ "obj-61", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-37", 2 ],
                                    "midpoints": [ 253.0, 385.0, 427.5, 385.0 ],
                                    "source": [ "obj-65", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-60", 0 ],
                                    "midpoints": [ 242.5, 373.0, 242.5, 373.0 ],
                                    "source": [ "obj-65", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-27", 0 ],
                                    "source": [ "obj-67", 0 ]
                                }
                            }
                        ]
                    },
                    "patching_rect": [ 3193.6169984340668, 2579.787215590477, 103.0, 22.0 ],
                    "text": "p \"feature lookup\""
                }
            },
            {
                "box": {
                    "id": "obj-371",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "bang", "bang" ],
                    "patching_rect": [ 3193.6169984340668, 2391.489344596863, 32.0, 22.0 ],
                    "text": "t b b"
                }
            },
            {
                "box": {
                    "bgcolor": [ 0.2, 0.2, 0.2, 0.0 ],
                    "contdata": 1,
                    "id": "obj-369",
                    "maxclass": "multislider",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "orientation": 0,
                    "outlettype": [ "", "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 3193.6169984340668, 2472.340407848358, 304.0, 85.0 ],
                    "setminmax": [ 0.0, 1.0 ],
                    "slidercolor": [ 1.0, 0.792156862745098, 0.0, 1.0 ]
                }
            },
            {
                "box": {
                    "filename": "fluid.waveform~",
                    "id": "obj-370",
                    "maxclass": "jsui",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 3193.6169984340668, 2472.340407848358, 304.0, 85.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-364",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "bang", "bang" ],
                    "patching_rect": [ 2608.5106196403503, 803.1914836168289, 32.0, 22.0 ],
                    "text": "t b b"
                }
            },
            {
                "box": {
                    "id": "obj-357",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patcher": {
                        "fileversion": 1,
                        "appversion": {
                            "major": 9,
                            "minor": 1,
                            "revision": 4,
                            "architecture": "x64",
                            "modernui": 1
                        },
                        "classnamespace": "box",
                        "rect": [ 895.0, 455.0, 799.0, 511.0 ],
                        "boxes": [
                            {
                                "box": {
                                    "id": "obj-16",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "", "" ],
                                    "patching_rect": [ 133.0, 178.0, 387.0, 22.0 ],
                                    "text": "fluid.bufselect~ @source stem_vocals @destination stem_vocals.mono"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-13",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 2,
                                    "outlettype": [ "bang", "" ],
                                    "patching_rect": [ 133.0, 95.0, 45.0, 22.0 ],
                                    "text": "sel 1"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-8",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 10,
                                    "outlettype": [ "float", "list", "float", "float", "float", "float", "float", "", "int", "" ],
                                    "patching_rect": [ 12.0, 57.0, 113.5, 22.0 ],
                                    "text": "info~ stem_vocals"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-7",
                                    "maxclass": "message",
                                    "numinlets": 2,
                                    "numoutlets": 1,
                                    "outlettype": [ "" ],
                                    "patching_rect": [ 582.0, 229.0, 82.0, 22.0 ],
                                    "text": "clear, size 1 1"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-4",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "bang", "bang" ],
                                    "patching_rect": [ 338.0, 178.0, 263.0, 22.0 ],
                                    "text": "t b b"
                                }
                            },
                            {
                                "box": {
                                    "color": [ 0.423529411764706, 0.513725490196078, 1.0, 1.0 ],
                                    "id": "obj-14",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "float", "bang" ],
                                    "patching_rect": [ 582.0, 268.0, 149.0, 22.0 ],
                                    "text": "buffer~ stem_vocals.mono"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-5",
                                    "maxclass": "message",
                                    "numinlets": 2,
                                    "numoutlets": 1,
                                    "outlettype": [ "" ],
                                    "patching_rect": [ 338.0, 229.0, 201.0, 22.0 ],
                                    "text": "startchan 0, bang, startchan 1, bang"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-3",
                                    "linecount": 3,
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "", "" ],
                                    "patching_rect": [ 338.0, 268.0, 231.0, 49.0 ],
                                    "text": "fluid.bufcompose~ @source stem_vocals @destination stem_vocals.mono @destgain 0.5 @numchans 1"
                                }
                            },
                            {
                                "box": {
                                    "comment": "",
                                    "id": "obj-2",
                                    "index": 1,
                                    "maxclass": "outlet",
                                    "numinlets": 1,
                                    "numoutlets": 0,
                                    "patching_rect": [ 133.0, 371.0, 30.0, 30.0 ]
                                }
                            },
                            {
                                "box": {
                                    "comment": "",
                                    "id": "obj-1",
                                    "index": 1,
                                    "maxclass": "inlet",
                                    "numinlets": 0,
                                    "numoutlets": 1,
                                    "outlettype": [ "bang" ],
                                    "patching_rect": [ 12.0, 9.0, 30.0, 30.0 ]
                                }
                            }
                        ],
                        "lines": [
                            {
                                "patchline": {
                                    "destination": [ "obj-8", 0 ],
                                    "source": [ "obj-1", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-16", 0 ],
                                    "midpoints": [ 142.5, 120.0, 142.5, 120.0 ],
                                    "source": [ "obj-13", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-4", 0 ],
                                    "midpoints": [ 168.5, 165.0, 347.5, 165.0 ],
                                    "source": [ "obj-13", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-2", 0 ],
                                    "source": [ "obj-16", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-2", 0 ],
                                    "source": [ "obj-3", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-5", 0 ],
                                    "source": [ "obj-4", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-7", 0 ],
                                    "source": [ "obj-4", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-3", 0 ],
                                    "source": [ "obj-5", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-14", 0 ],
                                    "source": [ "obj-7", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-13", 0 ],
                                    "source": [ "obj-8", 8 ]
                                }
                            }
                        ],
                        "styles": [
                            {
                                "name": "max6box",
                                "default": {
                                    "accentcolor": [ 0.8, 0.839216, 0.709804, 1.0 ],
                                    "bgcolor": [ 1.0, 1.0, 1.0, 0.5 ],
                                    "textcolor_inverse": [ 0.0, 0.0, 0.0, 1.0 ]
                                },
                                "parentstyle": "",
                                "multi": 0
                            },
                            {
                                "name": "max6inlet",
                                "default": {
                                    "color": [ 0.423529, 0.372549, 0.27451, 1.0 ]
                                },
                                "parentstyle": "",
                                "multi": 0
                            },
                            {
                                "name": "max6message",
                                "default": {
                                    "bgfillcolor": {
                                        "angle": 270.0,
                                        "autogradient": 0,
                                        "color": [ 0.290196, 0.309804, 0.301961, 1.0 ],
                                        "color1": [ 0.866667, 0.866667, 0.866667, 1.0 ],
                                        "color2": [ 0.788235, 0.788235, 0.788235, 1.0 ],
                                        "proportion": 0.39,
                                        "type": "gradient"
                                    },
                                    "textcolor_inverse": [ 0.0, 0.0, 0.0, 1.0 ]
                                },
                                "parentstyle": "max6box",
                                "multi": 0
                            },
                            {
                                "name": "max6outlet",
                                "default": {
                                    "color": [ 0.0, 0.454902, 0.498039, 1.0 ]
                                },
                                "parentstyle": "",
                                "multi": 0
                            }
                        ]
                    },
                    "patching_rect": [ 2608.5106196403503, 603.1914850473404, 143.0, 22.0 ],
                    "text": "p stereo_to_mono.vocals"
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-359",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 2893.617000579834, 2695.7446615695953, 25.0, 20.0 ],
                    "text": "G#",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-360",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 2865.9574263095856, 2695.7446615695953, 19.0, 20.0 ],
                    "text": "G",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-361",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 2835.1063627004623, 2695.7446615695953, 23.0, 20.0 ],
                    "text": "F#",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-362",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 2808.510618209839, 2695.7446615695953, 19.0, 20.0 ],
                    "text": "F",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-77",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 2781.9148737192154, 2695.7446615695953, 19.0, 20.0 ],
                    "text": "E",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-78",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 2746.8084909915924, 2695.7446615695953, 24.0, 20.0 ],
                    "text": "D#",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-79",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 2720.212746500969, 2695.7446615695953, 19.0, 20.0 ],
                    "text": "D",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-80",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 2689.3616828918457, 2695.7446615695953, 24.0, 20.0 ],
                    "text": "C#",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-81",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 2662.7659384012222, 2695.7446615695953, 19.0, 20.0 ],
                    "text": "C",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-82",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 2631.914874792099, 2695.7446615695953, 19.0, 20.0 ],
                    "text": "B",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-363",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 2605.3191303014755, 2695.7446615695953, 23.0, 20.0 ],
                    "text": "A#",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "bubbleside": 0,
                    "id": "obj-83",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 2574.4680666923523, 2695.7446615695953, 19.0, 20.0 ],
                    "text": "A",
                    "textjustification": 1
                }
            },
            {
                "box": {
                    "color": [ 0.431372549019608, 0.431372549019608, 0.431372549019608, 1.0 ],
                    "id": "obj-358",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 2570.2127475738525, 260.63829600811005, 149.0, 22.0 ],
                    "saved_attribute_attributes": {
                        "color": {
                            "expression": "themecolor.live_surface_frame_focus"
                        }
                    },
                    "saved_newobj_attribute_attributes": {
                        "color": {
                            "expression": "themecolor.live_surface_frame_focus"
                        }
                    },
                    "text": "buffer~ stem_vocals.mono"
                }
            },
            {
                "box": {
                    "id": "obj-356",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "bang", "bang" ],
                    "patching_rect": [ 2570.2127475738525, 2379.7872170209885, 32.0, 22.0 ],
                    "text": "t b b"
                }
            },
            {
                "box": {
                    "id": "obj-355",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2815.9574266672134, 2422.340408205986, 253.0, 22.0 ],
                    "text": "clear, addlayer audiobuffer stem_vocals.mono"
                }
            },
            {
                "box": {
                    "id": "obj-353",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2570.2127475738525, 2422.340408205986, 236.0, 22.0 ],
                    "text": "features stem_vocals_chroma.features red"
                }
            },
            {
                "box": {
                    "candycane": 12,
                    "ghostbar": 100,
                    "id": "obj-84",
                    "ignoreclick": 1,
                    "maxclass": "multislider",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 2570.2127475738525, 2618.085087656975, 348.0, 77.0 ],
                    "presentation": 1,
                    "presentation_rect": [ 49.833344, 47.5, 425.0, 156.0 ],
                    "setminmax": [ 0.0, 0.20000000298023224 ],
                    "size": 12
                }
            },
            {
                "box": {
                    "id": "obj-350",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patcher": {
                        "fileversion": 1,
                        "appversion": {
                            "major": 9,
                            "minor": 1,
                            "revision": 4,
                            "architecture": "x64",
                            "modernui": 1
                        },
                        "classnamespace": "box",
                        "rect": [ 84.0, 131.0, 421.0, 591.0 ],
                        "boxes": [
                            {
                                "box": {
                                    "id": "obj-65",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "bang", "int" ],
                                    "patching_rect": [ 233.0, 348.0, 29.5, 22.0 ],
                                    "text": "t b i"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-61",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 2,
                                    "outlettype": [ "", "" ],
                                    "patching_rect": [ 125.5, 468.0, 51.0, 22.0 ],
                                    "text": "zl.group"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-60",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 1,
                                    "outlettype": [ "int" ],
                                    "patching_rect": [ 233.0, 398.0, 29.5, 22.0 ],
                                    "text": "int"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-59",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "bang", "int" ],
                                    "patching_rect": [ 18.0, 262.0, 90.0, 22.0 ],
                                    "text": "t b i"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-58",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 3,
                                    "outlettype": [ "bang", "bang", "int" ],
                                    "patching_rect": [ 18.0, 308.0, 234.0, 22.0 ],
                                    "text": "uzi 12"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-55",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 1,
                                    "outlettype": [ "" ],
                                    "patching_rect": [ 18.0, 228.0, 39.0, 22.0 ],
                                    "text": "round"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-52",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "float", "bang" ],
                                    "patching_rect": [ 18.0, 108.0, 49.0, 22.0 ],
                                    "text": "t f b"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-51",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 1,
                                    "outlettype": [ "float" ],
                                    "patching_rect": [ 18.0, 188.0, 49.0, 22.0 ],
                                    "text": "* 1."
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-43",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 3,
                                    "outlettype": [ "", "", "" ],
                                    "patching_rect": [ 48.0, 158.0, 135.0, 22.0 ],
                                    "text": "getattr samps @listen 0"
                                }
                            },
                            {
                                "box": {
                                    "color": [ 1.0, 0.43921568627451, 0.662745098039216, 1.0 ],
                                    "id": "obj-42",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "float", "bang" ],
                                    "patching_rect": [ 106.0, 188.0, 209.0, 22.0 ],
                                    "text": "buffer~ stem_vocals_chroma.features"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-37",
                                    "maxclass": "newobj",
                                    "numinlets": 3,
                                    "numoutlets": 1,
                                    "outlettype": [ "float" ],
                                    "patching_rect": [ 233.0, 428.0, 215.0, 22.0 ],
                                    "text": "peek~ stem_vocals_chroma.features"
                                }
                            },
                            {
                                "box": {
                                    "format": 6,
                                    "id": "obj-27",
                                    "maxclass": "flonum",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "", "bang" ],
                                    "parameter_enable": 0,
                                    "patching_rect": [ 18.0, 68.0, 50.0, 22.0 ]
                                }
                            },
                            {
                                "box": {
                                    "comment": "",
                                    "id": "obj-67",
                                    "index": 1,
                                    "maxclass": "inlet",
                                    "numinlets": 0,
                                    "numoutlets": 1,
                                    "outlettype": [ "" ],
                                    "patching_rect": [ 18.0, 8.0, 30.0, 30.0 ]
                                }
                            },
                            {
                                "box": {
                                    "comment": "",
                                    "id": "obj-68",
                                    "index": 1,
                                    "maxclass": "outlet",
                                    "numinlets": 1,
                                    "numoutlets": 0,
                                    "patching_rect": [ 125.5, 550.0, 30.0, 30.0 ]
                                }
                            }
                        ],
                        "lines": [
                            {
                                "patchline": {
                                    "destination": [ "obj-52", 0 ],
                                    "source": [ "obj-27", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-61", 0 ],
                                    "midpoints": [ 242.5, 451.0, 135.0, 451.0 ],
                                    "source": [ "obj-37", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-42", 0 ],
                                    "source": [ "obj-43", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-51", 1 ],
                                    "source": [ "obj-43", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-55", 0 ],
                                    "source": [ "obj-51", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-43", 0 ],
                                    "source": [ "obj-52", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-51", 0 ],
                                    "source": [ "obj-52", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-59", 0 ],
                                    "source": [ "obj-55", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-61", 0 ],
                                    "source": [ "obj-58", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-65", 0 ],
                                    "source": [ "obj-58", 2 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-58", 0 ],
                                    "source": [ "obj-59", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-60", 1 ],
                                    "midpoints": [ 98.5, 295.0, 272.0, 295.0, 272.0, 385.0, 253.0, 385.0 ],
                                    "source": [ "obj-59", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-37", 0 ],
                                    "source": [ "obj-60", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-68", 0 ],
                                    "source": [ "obj-61", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-37", 2 ],
                                    "midpoints": [ 253.0, 385.0, 438.5, 385.0 ],
                                    "source": [ "obj-65", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-60", 0 ],
                                    "midpoints": [ 242.5, 373.0, 242.5, 373.0 ],
                                    "source": [ "obj-65", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-27", 0 ],
                                    "source": [ "obj-67", 0 ]
                                }
                            }
                        ]
                    },
                    "patching_rect": [ 2570.2127475738525, 2579.787215590477, 103.0, 22.0 ],
                    "text": "p \"feature lookup\""
                }
            },
            {
                "box": {
                    "bgcolor": [ 0.2, 0.2, 0.2, 0.0 ],
                    "contdata": 1,
                    "id": "obj-351",
                    "maxclass": "multislider",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "orientation": 0,
                    "outlettype": [ "", "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 2570.2127475738525, 2476.595726966858, 304.0, 85.0 ],
                    "setminmax": [ 0.0, 1.0 ],
                    "slidercolor": [ 1.0, 0.792156862745098, 0.0, 1.0 ]
                }
            },
            {
                "box": {
                    "filename": "fluid.waveform~",
                    "id": "obj-352",
                    "maxclass": "jsui",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 2565.957428455353, 2476.595726966858, 304.0, 85.0 ]
                }
            },
            {
                "box": {
                    "color": [ 1.0, 0.0, 0.0, 1.0 ],
                    "id": "obj-348",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 2755.319129228592, 364.89361441135406, 209.0, 22.0 ],
                    "text": "buffer~ stem_vocals_chroma.features"
                }
            },
            {
                "box": {
                    "id": "obj-347",
                    "maxclass": "button",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 2570.2127475738525, 2306.3829622268677, 24.0, 24.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-346",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 2570.2127475738525, 2348.9361534118652, 475.0, 22.0 ],
                    "text": "fluid.bufchroma~ @source stem_vocals.mono @features stem_vocals_chroma.features"
                }
            },
            {
                "box": {
                    "id": "obj-341",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "bang", "bang" ],
                    "patching_rect": [ 2570.2127475738525, 2134.0425379276276, 32.0, 22.0 ],
                    "text": "t b b"
                }
            },
            {
                "box": {
                    "id": "obj-340",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2831.9148733615875, 2168.0850908756256, 253.0, 22.0 ],
                    "text": "clear, addlayer audiobuffer stem_vocals.mono"
                }
            },
            {
                "box": {
                    "id": "obj-339",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "bang", "bang" ],
                    "patching_rect": [ 3193.6169984340668, 2137.2340272665024, 32.0, 22.0 ],
                    "text": "t b b"
                }
            },
            {
                "box": {
                    "id": "obj-338",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 3451.063805103302, 2172.3404099941254, 252.0, 22.0 ],
                    "text": "clear, addlayer audiobuffer stem_drums.mono"
                }
            },
            {
                "box": {
                    "id": "obj-337",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 4124.468055605888, 2172.3404099941254, 244.0, 22.0 ],
                    "text": "clear, addlayer audiobuffer stem_bass.mono"
                }
            },
            {
                "box": {
                    "id": "obj-335",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "bang", "bang" ],
                    "patching_rect": [ 3877.6595467329025, 2137.2340272665024, 32.0, 22.0 ],
                    "text": "t b b"
                }
            },
            {
                "box": {
                    "id": "obj-330",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "bang", "bang" ],
                    "patching_rect": [ 4531.91486120224, 2126.595729470253, 32.0, 22.0 ],
                    "text": "t b b"
                }
            },
            {
                "box": {
                    "id": "obj-329",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 4777.659540295601, 2164.893601536751, 245.0, 22.0 ],
                    "text": "clear, addlayer audiobuffer stem_melo.mono"
                }
            },
            {
                "box": {
                    "id": "obj-327",
                    "maxclass": "button",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 2574.4680666923523, 998.9361630678177, 24.0, 24.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-325",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "bang", "bang" ],
                    "patching_rect": [ 2608.5106196403503, 1103.1914814710617, 32.0, 22.0 ],
                    "text": "t b b"
                }
            },
            {
                "box": {
                    "id": "obj-323",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "bang", "bang" ],
                    "patching_rect": [ 3227.659551382065, 1103.1914814710617, 32.0, 22.0 ],
                    "text": "t b b"
                }
            },
            {
                "box": {
                    "id": "obj-322",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "bang", "bang" ],
                    "patching_rect": [ 3908.5106103420258, 1091.4893538951874, 32.0, 22.0 ],
                    "text": "t b b"
                }
            },
            {
                "box": {
                    "id": "obj-321",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "bang", "bang" ],
                    "patching_rect": [ 4574.468052387238, 1095.7446730136871, 32.0, 22.0 ],
                    "text": "t b b"
                }
            },
            {
                "box": {
                    "id": "obj-315",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 4531.91486120224, 2164.893601536751, 234.0, 22.0 ],
                    "text": "features stem_melo_pitch.features fuschia"
                }
            },
            {
                "box": {
                    "id": "obj-316",
                    "maxclass": "button",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 4531.91486120224, 2037.2340279817581, 24.0, 24.0 ]
                }
            },
            {
                "box": {
                    "filename": "fluid.waveform~",
                    "id": "obj-317",
                    "maxclass": "jsui",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 4531.91486120224, 2203.1914736032486, 303.53984743356705, 80.53097993135452 ]
                }
            },
            {
                "box": {
                    "id": "obj-318",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 4531.91486120224, 2095.7446658611298, 466.0, 22.0 ],
                    "text": "fluid.bufpitch~ @source stem_melo.mono @features stem_melo_pitch.features"
                }
            },
            {
                "box": {
                    "id": "obj-306",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 3877.6595467329025, 2172.3404099941254, 233.0, 22.0 ],
                    "text": "features stem_bass_pitch.features fuschia"
                }
            },
            {
                "box": {
                    "id": "obj-307",
                    "maxclass": "button",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 3877.6595467329025, 2037.2340279817581, 24.0, 24.0 ]
                }
            },
            {
                "box": {
                    "filename": "fluid.waveform~",
                    "id": "obj-308",
                    "maxclass": "jsui",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 3877.6595467329025, 2203.1914736032486, 303.53984743356705, 80.53097993135452 ]
                }
            },
            {
                "box": {
                    "id": "obj-309",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 3877.6595467329025, 2095.7446658611298, 464.0, 22.0 ],
                    "text": "fluid.bufpitch~ @source stem_bass.mono @features stem_bass_pitch.features"
                }
            },
            {
                "box": {
                    "id": "obj-302",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 3193.6169984340668, 2172.3404099941254, 241.0, 22.0 ],
                    "text": "features stem_drums_pitch.features fuschia"
                }
            },
            {
                "box": {
                    "id": "obj-303",
                    "maxclass": "button",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 3193.6169984340668, 2037.2340279817581, 24.0, 24.0 ]
                }
            },
            {
                "box": {
                    "filename": "fluid.waveform~",
                    "id": "obj-304",
                    "maxclass": "jsui",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 3193.6169984340668, 2203.1914736032486, 303.53984743356705, 80.53097993135452 ]
                }
            },
            {
                "box": {
                    "id": "obj-305",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 3193.6169984340668, 2095.7446658611298, 480.0, 22.0 ],
                    "text": "fluid.bufpitch~ @source stem_drums.mono @features stem_drums_pitch.features"
                }
            },
            {
                "box": {
                    "id": "obj-301",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2570.2127475738525, 2168.0850908756256, 242.0, 22.0 ],
                    "text": "features stem_vocals_pitch.features fuschia"
                }
            },
            {
                "box": {
                    "id": "obj-299",
                    "maxclass": "button",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 2570.2127475738525, 2037.2340279817581, 24.0, 24.0 ]
                }
            },
            {
                "box": {
                    "filename": "fluid.waveform~",
                    "id": "obj-297",
                    "maxclass": "jsui",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 2570.2127475738525, 2198.936154484749, 303.53984743356705, 80.53097993135452 ]
                }
            },
            {
                "box": {
                    "color": [ 1.0, 0.0, 0.0, 1.0 ],
                    "id": "obj-295",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 4739.361668229103, 345.74467837810516, 187.0, 22.0 ],
                    "text": "buffer~ stem_melo_pitch.features"
                }
            },
            {
                "box": {
                    "color": [ 1.0, 0.0, 0.0, 1.0 ],
                    "id": "obj-294",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 4024.468056321144, 345.74467837810516, 186.0, 22.0 ],
                    "text": "buffer~ stem_bass_pitch.features"
                }
            },
            {
                "box": {
                    "color": [ 1.0, 0.0, 0.0, 1.0 ],
                    "id": "obj-293",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 3358.5106142759323, 345.74467837810516, 194.0, 22.0 ],
                    "text": "buffer~ stem_drums_pitch.features"
                }
            },
            {
                "box": {
                    "color": [ 1.0, 0.0, 0.0, 1.0 ],
                    "id": "obj-292",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 2755.319129228592, 337.23404014110565, 212.4075037240982, 22.0 ],
                    "text": "buffer~ stem_vocals_pitch.features"
                }
            },
            {
                "box": {
                    "color": [ 1.0, 0.0, 0.0, 1.0 ],
                    "id": "obj-288",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 2755.319129228592, 318.08510410785675, 190.85577845573425, 22.0 ],
                    "text": "buffer~ stem_vocals_loud.stats"
                }
            },
            {
                "box": {
                    "color": [ 1.0, 0.0, 0.0, 1.0 ],
                    "id": "obj-287",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 2755.319129228592, 291.4893596172333, 208.95922768115997, 22.0 ],
                    "text": "buffer~ stem_vocals_loud.features"
                }
            },
            {
                "box": {
                    "id": "obj-275",
                    "maxclass": "button",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 2570.2127475738525, 1822.3404124975204, 24.0, 24.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-276",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 2612.76593875885, 1998.9361559152603, 169.0, 20.0 ],
                    "text": "The median loudness in dBFS"
                }
            },
            {
                "box": {
                    "format": 6,
                    "id": "obj-277",
                    "maxclass": "flonum",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "bang" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 2570.2127475738525, 1998.9361559152603, 50.0, 22.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-278",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2570.2127475738525, 1964.8936029672623, 29.5, 22.0 ],
                    "text": "$6"
                }
            },
            {
                "box": {
                    "id": "obj-279",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "list" ],
                    "patching_rect": [ 2570.2127475738525, 1922.3404117822647, 251.0, 22.0 ],
                    "text": "fluid.buf2list @source stem_vocals_loud.stats"
                }
            },
            {
                "box": {
                    "color": [ 1.0, 0.43921568627451, 0.662745098039216, 1.0 ],
                    "id": "obj-280",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 2570.2127475738525, 1868.0850930213928, 449.0, 22.0 ],
                    "text": "fluid.bufstats~ @source stem_vocals_loud.features @stats stem_vocals_loud.stats"
                }
            },
            {
                "box": {
                    "id": "obj-281",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "bang", "bang" ],
                    "patching_rect": [ 2574.4680666923523, 1591.4893503189087, 32.0, 22.0 ],
                    "text": "t b b"
                }
            },
            {
                "box": {
                    "id": "obj-283",
                    "linecount": 3,
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2574.4680666923523, 1637.234030842781, 208.42106008529663, 49.0 ],
                    "text": "addlayer featuresbuffer stem_vocals_loud.features, color stem_vocals_loud.features 1. 1. 0. 1."
                }
            },
            {
                "box": {
                    "id": "obj-284",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2796.8084906339645, 1637.234030842781, 253.0, 22.0 ],
                    "text": "clear, addlayer audiobuffer stem_vocals.mono"
                }
            },
            {
                "box": {
                    "bgcolor": [ 0.2, 0.2, 0.2, 0.0 ],
                    "id": "obj-285",
                    "maxclass": "multislider",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "orientation": 0,
                    "outlettype": [ "", "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 2574.4680666923523, 1718.0850940942764, 311.0, 90.0 ],
                    "setminmax": [ 0.0, 1.0 ],
                    "slidercolor": [ 0.949019607843137, 0.670588235294118, 1.0, 1.0 ],
                    "thickness": 4
                }
            },
            {
                "box": {
                    "filename": "fluid.waveform~",
                    "id": "obj-286",
                    "maxclass": "jsui",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 2574.4680666923523, 1718.0850940942764, 311.1111259460449, 89.58333760499954 ]
                }
            },
            {
                "box": {
                    "id": "obj-271",
                    "maxclass": "button",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 3201.0638068914413, 998.9361630678177, 24.0, 24.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-270",
                    "maxclass": "button",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 2574.4680666923523, 1479.78722345829, 24.0, 24.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-258",
                    "maxclass": "button",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 3196.8084877729416, 1822.3404124975204, 24.0, 24.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-259",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 3251.0638065338135, 2003.19147503376, 169.0, 20.0 ],
                    "text": "The median loudness in dBFS"
                }
            },
            {
                "box": {
                    "format": 6,
                    "id": "obj-260",
                    "maxclass": "flonum",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "bang" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 3196.8084877729416, 2003.19147503376, 50.0, 22.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-261",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 3196.8084877729416, 1960.6382838487625, 29.5, 22.0 ],
                    "text": "$6"
                }
            },
            {
                "box": {
                    "id": "obj-262",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "list" ],
                    "patching_rect": [ 3196.8084877729416, 1922.3404117822647, 251.0, 22.0 ],
                    "text": "fluid.buf2list @source stem_drums_loud.stats"
                }
            },
            {
                "box": {
                    "color": [ 1.0, 0.43921568627451, 0.662745098039216, 1.0 ],
                    "id": "obj-263",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 3196.8084877729416, 1868.0850930213928, 448.0, 22.0 ],
                    "text": "fluid.bufstats~ @source stem_drums_loud.features @stats stem_drums_loud.stats"
                }
            },
            {
                "box": {
                    "id": "obj-264",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "bang", "bang" ],
                    "patching_rect": [ 3208.510615348816, 1587.234031200409, 32.0, 22.0 ],
                    "text": "t b b"
                }
            },
            {
                "box": {
                    "id": "obj-265",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 3427.6595499515533, 1622.340413928032, 252.0, 22.0 ],
                    "text": "clear, addlayer audiobuffer stem_drums.mono"
                }
            },
            {
                "box": {
                    "id": "obj-266",
                    "linecount": 3,
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 3208.510615348816, 1622.340413928032, 207.14285516738892, 49.0 ],
                    "text": "addlayer featuresbuffer stem_drums_loud.features, color stem_drums_loud.features 1. 1. 0. 1."
                }
            },
            {
                "box": {
                    "bgcolor": [ 0.2, 0.2, 0.2, 0.0 ],
                    "id": "obj-268",
                    "maxclass": "multislider",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "orientation": 0,
                    "outlettype": [ "", "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 3208.510615348816, 1706.382966518402, 311.0, 90.0 ],
                    "setminmax": [ 0.0, 1.0 ],
                    "slidercolor": [ 0.949019607843137, 0.670588235294118, 1.0, 1.0 ],
                    "thickness": 4
                }
            },
            {
                "box": {
                    "filename": "fluid.waveform~",
                    "id": "obj-269",
                    "maxclass": "jsui",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 3208.510615348816, 1706.382966518402, 311.1111259460449, 89.58333760499954 ]
                }
            },
            {
                "box": {
                    "id": "obj-254",
                    "maxclass": "button",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 3208.510615348816, 1479.78722345829, 24.0, 24.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-253",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "patching_rect": [ 3165.9574241638184, 572.3404214382172, 22.0, 22.0 ],
                    "text": "t b"
                }
            },
            {
                "box": {
                    "color": [ 1.0, 0.0, 0.0, 1.0 ],
                    "id": "obj-252",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 3358.5106142759323, 318.08510410785675, 173.0, 22.0 ],
                    "text": "buffer~ stem_drums_loud.stats"
                }
            },
            {
                "box": {
                    "color": [ 1.0, 0.0, 0.0, 1.0 ],
                    "id": "obj-251",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 3358.5106142759323, 291.4893596172333, 191.0, 22.0 ],
                    "text": "buffer~ stem_drums_loud.features"
                }
            },
            {
                "box": {
                    "id": "obj-250",
                    "maxclass": "button",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 3881.9148658514023, 998.9361630678177, 24.0, 24.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-249",
                    "linecount": 2,
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2570.0002450942993, 125.38462734222412, 507.0, 35.0 ],
                    "text": "read \"/Users/alexandregagne/Documents/EBYS/data/stems/htdemucs/DREPTO CE3o/DREPTO CE3o_vocals.wav\""
                }
            },
            {
                "box": {
                    "id": "obj-248",
                    "linecount": 2,
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 3165.9574241638184, 125.38462734222412, 502.0, 35.0 ],
                    "text": "read \"/Users/alexandregagne/Documents/EBYS/data/stems/htdemucs/DREPTO CE3o/DREPTO CE3o_drums.wav\""
                }
            },
            {
                "box": {
                    "id": "obj-247",
                    "linecount": 2,
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 4539.361669659615, 125.38462734222412, 499.0, 35.0 ],
                    "text": "read \"/Users/alexandregagne/Documents/EBYS/data/stems/htdemucs/DREPTO CE3o/DREPTO CE3o_other.wav\""
                }
            },
            {
                "box": {
                    "id": "obj-245",
                    "linecount": 2,
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 3824.0240008234978, 125.38462734222412, 489.0, 35.0 ],
                    "text": "read \"/Users/alexandregagne/Documents/EBYS/data/stems/htdemucs/DREPTO CE3o/DREPTO CE3o_bass.wav\""
                }
            },
            {
                "box": {
                    "id": "obj-243",
                    "maxclass": "button",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 3877.6595467329025, 1479.78722345829, 24.0, 24.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-227",
                    "maxclass": "button",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 3877.6595467329025, 1822.3404124975204, 24.0, 24.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-228",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 3927.6595463752747, 2003.19147503376, 169.0, 20.0 ],
                    "text": "The median loudness in dBFS"
                }
            },
            {
                "box": {
                    "format": 6,
                    "id": "obj-229",
                    "maxclass": "flonum",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "bang" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 3877.6595467329025, 2003.19147503376, 50.0, 22.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-230",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 3877.6595467329025, 1968.085092306137, 29.5, 22.0 ],
                    "text": "$6"
                }
            },
            {
                "box": {
                    "id": "obj-237",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "list" ],
                    "patching_rect": [ 3877.6595467329025, 1922.3404117822647, 243.0, 22.0 ],
                    "text": "fluid.buf2list @source stem_bass_loud.stats"
                }
            },
            {
                "box": {
                    "color": [ 1.0, 0.43921568627451, 0.662745098039216, 1.0 ],
                    "id": "obj-238",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 3877.6595467329025, 1868.0850930213928, 432.0, 22.0 ],
                    "text": "fluid.bufstats~ @source stem_bass_loud.features @stats stem_bass_loud.stats"
                }
            },
            {
                "box": {
                    "id": "obj-226",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "patching_rect": [ 3824.4680577516556, 572.3404214382172, 22.0, 22.0 ],
                    "text": "t b"
                }
            },
            {
                "box": {
                    "id": "obj-220",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "bang", "bang" ],
                    "patching_rect": [ 3877.6595467329025, 1568.08509516716, 32.0, 22.0 ],
                    "text": "t b b"
                }
            },
            {
                "box": {
                    "id": "obj-222",
                    "linecount": 5,
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 3877.6595467329025, 1606.3829672336578, 139.18917989730835, 76.0 ],
                    "text": "addlayer featuresbuffer stem_bass_loud.features, color stem_bass_loud.features 1. 1. 0. 1."
                }
            },
            {
                "box": {
                    "id": "obj-223",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 4024.468056321144, 1606.3829672336578, 244.0, 22.0 ],
                    "text": "clear, addlayer audiobuffer stem_bass.mono"
                }
            },
            {
                "box": {
                    "bgcolor": [ 0.2, 0.2, 0.2, 0.0 ],
                    "id": "obj-224",
                    "maxclass": "multislider",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "orientation": 0,
                    "outlettype": [ "", "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 3877.6595467329025, 1695.7446687221527, 311.0, 90.0 ],
                    "setminmax": [ 0.0, 1.0 ],
                    "slidercolor": [ 0.949019607843137, 0.670588235294118, 1.0, 1.0 ],
                    "thickness": 4
                }
            },
            {
                "box": {
                    "filename": "fluid.waveform~",
                    "id": "obj-225",
                    "maxclass": "jsui",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 3877.6595467329025, 1695.7446687221527, 311.1111259460449, 89.58333760499954 ]
                }
            },
            {
                "box": {
                    "color": [ 1.0, 0.0, 0.0, 1.0 ],
                    "id": "obj-219",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 4024.468056321144, 318.08510410785675, 165.0, 22.0 ],
                    "text": "buffer~ stem_bass_loud.stats"
                }
            },
            {
                "box": {
                    "color": [ 1.0, 0.0, 0.0, 1.0 ],
                    "id": "obj-218",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 4024.468056321144, 291.4893596172333, 183.0, 22.0 ],
                    "text": "buffer~ stem_bass_loud.features"
                }
            },
            {
                "box": {
                    "id": "obj-217",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "bang", "bang" ],
                    "patching_rect": [ 4535.106350541115, 1568.08509516716, 32.0, 22.0 ],
                    "text": "t b b"
                }
            },
            {
                "box": {
                    "id": "obj-216",
                    "linecount": 2,
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 4874.46805024147, 1606.3829672336578, 153.0, 35.0 ],
                    "text": "clear, addlayer audiobuffer stem_melo.mono"
                }
            },
            {
                "box": {
                    "id": "obj-208",
                    "linecount": 2,
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 4551.063797235489, 1606.3829672336578, 306.0, 35.0 ],
                    "text": "addlayer featuresbuffer stem_melo_loud.features, color stem_melo_loud.features 1. 1. 0. 1."
                }
            },
            {
                "box": {
                    "id": "obj-202",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "patching_rect": [ 4546.808478116989, 572.3404214382172, 22.0, 22.0 ],
                    "text": "t b"
                }
            },
            {
                "box": {
                    "id": "obj-192",
                    "maxclass": "button",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 4535.106350541115, 1479.78722345829, 24.0, 24.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-189",
                    "maxclass": "button",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 4546.808478116989, 998.9361630678177, 24.0, 24.0 ]
                }
            },
            {
                "box": {
                    "color": [ 1.0, 0.0, 0.0, 1.0 ],
                    "id": "obj-182",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 4735.106349110603, 291.4893596172333, 184.0, 22.0 ],
                    "text": "buffer~ stem_melo_loud.features"
                }
            },
            {
                "box": {
                    "id": "obj-181",
                    "maxclass": "button",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 4535.106350541115, 1822.3404124975204, 24.0, 24.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-169",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 4820.212731480598, 1998.9361559152603, 173.0, 20.0 ],
                    "text": "The average loudness in dBFS"
                }
            },
            {
                "box": {
                    "format": 6,
                    "id": "obj-170",
                    "maxclass": "flonum",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "bang" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 4765.957412719727, 1998.9361559152603, 50.0, 22.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-171",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 4765.957412719727, 1960.6382838487625, 29.5, 22.0 ],
                    "text": "$1"
                }
            },
            {
                "box": {
                    "id": "obj-173",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 4589.361669301987, 1998.9361559152603, 169.0, 20.0 ],
                    "text": "The median loudness in dBFS"
                }
            },
            {
                "box": {
                    "format": 6,
                    "id": "obj-175",
                    "maxclass": "flonum",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "bang" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 4535.106350541115, 1998.9361559152603, 50.0, 22.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-176",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 4535.106350541115, 1960.6382838487625, 29.5, 22.0 ],
                    "text": "$6"
                }
            },
            {
                "box": {
                    "color": [ 1.0, 0.0, 0.0, 1.0 ],
                    "id": "obj-24",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 4735.106349110603, 310.6382956504822, 166.0, 22.0 ],
                    "text": "buffer~ stem_melo_loud.stats"
                }
            },
            {
                "box": {
                    "id": "obj-177",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "list" ],
                    "patching_rect": [ 4535.106350541115, 1926.5957309007645, 243.0, 22.0 ],
                    "text": "fluid.buf2list @source stem_melo_loud.stats"
                }
            },
            {
                "box": {
                    "color": [ 1.0, 0.43921568627451, 0.662745098039216, 1.0 ],
                    "id": "obj-179",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 4535.106350541115, 1868.0850930213928, 433.0, 22.0 ],
                    "text": "fluid.bufstats~ @source stem_melo_loud.features @stats stem_melo_loud.stats"
                }
            },
            {
                "box": {
                    "bgcolor": [ 0.2, 0.2, 0.2, 0.0 ],
                    "id": "obj-157",
                    "maxclass": "multislider",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "orientation": 0,
                    "outlettype": [ "", "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 4551.063797235489, 1695.7446687221527, 311.0, 90.0 ],
                    "setminmax": [ 0.0, 1.0 ],
                    "slidercolor": [ 0.949019607843137, 0.670588235294118, 1.0, 1.0 ],
                    "thickness": 4
                }
            },
            {
                "box": {
                    "id": "obj-154",
                    "maxclass": "dict.view",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 4539.361669659615, 1318.0850969552994, 170.0, 150.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-155",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "dictionary" ],
                    "patcher": {
                        "fileversion": 1,
                        "appversion": {
                            "major": 9,
                            "minor": 1,
                            "revision": 4,
                            "architecture": "x64",
                            "modernui": 1
                        },
                        "classnamespace": "box",
                        "rect": [ 341.0, 132.0, 515.0, 725.0 ],
                        "boxes": [
                            {
                                "box": {
                                    "id": "obj-1",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 1,
                                    "outlettype": [ "" ],
                                    "patching_rect": [ 81.5, 476.0, 130.0, 22.0 ],
                                    "text": "loadmess 0 0 0 0 0 0 0"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-2",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 8,
                                    "outlettype": [ "", "", "", "", "", "", "", "" ],
                                    "patching_rect": [ 28.5, 517.0, 113.20833333333337, 22.0 ],
                                    "text": "unjoin 7"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-25",
                                    "linecount": 8,
                                    "maxclass": "newobj",
                                    "numinlets": 8,
                                    "numoutlets": 1,
                                    "outlettype": [ "dictionary" ],
                                    "patching_rect": [ 29.0, 552.0, 99.0, 116.0 ],
                                    "text": "dict.pack centroid(Hz): spread(Hz): skewness(ratio): kurtosis(ratio): rolloff(Hz): flatness(dB): crest(dB):"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-65",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "bang", "int" ],
                                    "patching_rect": [ 93.5, 349.0, 29.5, 22.0 ],
                                    "text": "t b i"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-61",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 2,
                                    "outlettype": [ "", "" ],
                                    "patching_rect": [ 28.5, 476.0, 51.0, 22.0 ],
                                    "text": "zl.group"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-60",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 1,
                                    "outlettype": [ "int" ],
                                    "patching_rect": [ 93.5, 390.0, 81.5, 22.0 ],
                                    "text": "int"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-59",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "bang", "int" ],
                                    "patching_rect": [ 18.0, 262.0, 90.0, 22.0 ],
                                    "text": "t b i"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-58",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 3,
                                    "outlettype": [ "bang", "bang", "int" ],
                                    "patching_rect": [ 18.0, 308.0, 40.0, 22.0 ],
                                    "text": "uzi 7"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-55",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 1,
                                    "outlettype": [ "" ],
                                    "patching_rect": [ 18.0, 228.0, 39.0, 22.0 ],
                                    "text": "round"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-52",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "float", "bang" ],
                                    "patching_rect": [ 18.0, 108.0, 49.0, 22.0 ],
                                    "text": "t f b"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-51",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 1,
                                    "outlettype": [ "float" ],
                                    "patching_rect": [ 18.0, 188.0, 49.0, 22.0 ],
                                    "text": "* 1."
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-43",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 3,
                                    "outlettype": [ "", "", "" ],
                                    "patching_rect": [ 48.0, 158.0, 135.0, 22.0 ],
                                    "text": "getattr samps @listen 0"
                                }
                            },
                            {
                                "box": {
                                    "color": [ 1.0, 0.43921568627451, 0.662745098039216, 1.0 ],
                                    "id": "obj-42",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "float", "bang" ],
                                    "patching_rect": [ 106.0, 188.0, 203.0, 22.0 ],
                                    "text": "buffer~ stem_melo_spectral.features"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-37",
                                    "maxclass": "newobj",
                                    "numinlets": 3,
                                    "numoutlets": 1,
                                    "outlettype": [ "float" ],
                                    "patching_rect": [ 93.5, 420.0, 199.0, 22.0 ],
                                    "text": "peek~ stem_melo_spectral.features"
                                }
                            },
                            {
                                "box": {
                                    "format": 6,
                                    "id": "obj-27",
                                    "maxclass": "flonum",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "", "bang" ],
                                    "parameter_enable": 0,
                                    "patching_rect": [ 18.0, 68.0, 50.0, 22.0 ]
                                }
                            },
                            {
                                "box": {
                                    "comment": "",
                                    "id": "obj-67",
                                    "index": 1,
                                    "maxclass": "inlet",
                                    "numinlets": 0,
                                    "numoutlets": 1,
                                    "outlettype": [ "" ],
                                    "patching_rect": [ 18.0, 8.0, 30.0, 30.0 ]
                                }
                            },
                            {
                                "box": {
                                    "comment": "",
                                    "id": "obj-68",
                                    "index": 1,
                                    "maxclass": "outlet",
                                    "numinlets": 1,
                                    "numoutlets": 0,
                                    "patching_rect": [ 29.0, 681.0, 30.0, 30.0 ]
                                }
                            }
                        ],
                        "lines": [
                            {
                                "patchline": {
                                    "destination": [ "obj-2", 0 ],
                                    "midpoints": [ 91.0, 501.0, 39.0, 501.0, 39.0, 513.0, 38.0, 513.0 ],
                                    "source": [ "obj-1", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-25", 6 ],
                                    "source": [ "obj-2", 6 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-25", 5 ],
                                    "source": [ "obj-2", 5 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-25", 4 ],
                                    "source": [ "obj-2", 4 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-25", 3 ],
                                    "source": [ "obj-2", 3 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-25", 2 ],
                                    "source": [ "obj-2", 2 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-25", 1 ],
                                    "source": [ "obj-2", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-25", 0 ],
                                    "source": [ "obj-2", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-68", 0 ],
                                    "source": [ "obj-25", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-52", 0 ],
                                    "source": [ "obj-27", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-61", 0 ],
                                    "midpoints": [ 103.0, 458.0, 38.0, 458.0 ],
                                    "source": [ "obj-37", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-42", 0 ],
                                    "source": [ "obj-43", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-51", 1 ],
                                    "source": [ "obj-43", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-55", 0 ],
                                    "source": [ "obj-51", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-43", 0 ],
                                    "source": [ "obj-52", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-51", 0 ],
                                    "source": [ "obj-52", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-59", 0 ],
                                    "source": [ "obj-55", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-61", 0 ],
                                    "source": [ "obj-58", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-65", 0 ],
                                    "midpoints": [ 48.5, 339.0, 103.0, 339.0 ],
                                    "source": [ "obj-58", 2 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-58", 0 ],
                                    "source": [ "obj-59", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-60", 1 ],
                                    "midpoints": [ 98.5, 336.5, 165.5, 336.5 ],
                                    "source": [ "obj-59", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-37", 0 ],
                                    "source": [ "obj-60", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-2", 0 ],
                                    "source": [ "obj-61", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-37", 2 ],
                                    "midpoints": [ 113.5, 372.0, 283.0, 372.0 ],
                                    "source": [ "obj-65", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-60", 0 ],
                                    "midpoints": [ 103.0, 375.0, 103.0, 375.0 ],
                                    "source": [ "obj-65", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-27", 0 ],
                                    "source": [ "obj-67", 0 ]
                                }
                            }
                        ],
                        "styles": [
                            {
                                "name": "max6box",
                                "default": {
                                    "accentcolor": [ 0.8, 0.839216, 0.709804, 1.0 ],
                                    "bgcolor": [ 1.0, 1.0, 1.0, 0.5 ],
                                    "textcolor_inverse": [ 0.0, 0.0, 0.0, 1.0 ]
                                },
                                "parentstyle": "",
                                "multi": 0
                            },
                            {
                                "name": "max6inlet",
                                "default": {
                                    "color": [ 0.423529, 0.372549, 0.27451, 1.0 ]
                                },
                                "parentstyle": "",
                                "multi": 0
                            },
                            {
                                "name": "max6message",
                                "default": {
                                    "bgfillcolor": {
                                        "angle": 270.0,
                                        "autogradient": 0,
                                        "color": [ 0.290196, 0.309804, 0.301961, 1.0 ],
                                        "color1": [ 0.866667, 0.866667, 0.866667, 1.0 ],
                                        "color2": [ 0.788235, 0.788235, 0.788235, 1.0 ],
                                        "proportion": 0.39,
                                        "type": "gradient"
                                    },
                                    "textcolor_inverse": [ 0.0, 0.0, 0.0, 1.0 ]
                                },
                                "parentstyle": "max6box",
                                "multi": 0
                            },
                            {
                                "name": "max6outlet",
                                "default": {
                                    "color": [ 0.0, 0.454902, 0.498039, 1.0 ]
                                },
                                "parentstyle": "",
                                "multi": 0
                            }
                        ]
                    },
                    "patching_rect": [ 4539.361669659615, 1279.7872248888016, 111.0, 22.0 ],
                    "text": "p \"feature lookup\""
                }
            },
            {
                "box": {
                    "bgcolor": [ 0.2, 0.2, 0.2, 0.0 ],
                    "contdata": 1,
                    "id": "obj-152",
                    "maxclass": "multislider",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "orientation": 0,
                    "outlettype": [ "", "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 4539.361669659615, 1160.6382895708084, 310.0, 90.0 ],
                    "setminmax": [ 0.0, 1.0 ],
                    "slidercolor": [ 0.254901960784314, 0.905882352941176, 0.450980392156863, 1.0 ]
                }
            },
            {
                "box": {
                    "filename": "fluid.waveform~",
                    "id": "obj-153",
                    "maxclass": "jsui",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 4539.361669659615, 1160.6382895708084, 311.1111259460449, 89.58333760499954 ]
                }
            },
            {
                "box": {
                    "id": "obj-150",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 4751.063795804977, 1126.5957366228104, 230.0, 22.0 ],
                    "text": "features stem_melo_spectral.features red"
                }
            },
            {
                "box": {
                    "id": "obj-151",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 4539.361669659615, 1126.5957366228104, 227.0, 22.0 ],
                    "text": "clear, waveform stem_melo.mono source"
                }
            },
            {
                "box": {
                    "id": "obj-148",
                    "maxclass": "dict.view",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 3877.6595467329025, 1306.382969379425, 170.0, 150.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-149",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "dictionary" ],
                    "patcher": {
                        "fileversion": 1,
                        "appversion": {
                            "major": 9,
                            "minor": 1,
                            "revision": 4,
                            "architecture": "x64",
                            "modernui": 1
                        },
                        "classnamespace": "box",
                        "rect": [ 341.0, 132.0, 515.0, 725.0 ],
                        "boxes": [
                            {
                                "box": {
                                    "id": "obj-1",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 1,
                                    "outlettype": [ "" ],
                                    "patching_rect": [ 81.5, 476.0, 130.0, 22.0 ],
                                    "text": "loadmess 0 0 0 0 0 0 0"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-2",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 8,
                                    "outlettype": [ "", "", "", "", "", "", "", "" ],
                                    "patching_rect": [ 28.5, 517.0, 113.20833333333337, 22.0 ],
                                    "text": "unjoin 7"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-25",
                                    "linecount": 8,
                                    "maxclass": "newobj",
                                    "numinlets": 8,
                                    "numoutlets": 1,
                                    "outlettype": [ "dictionary" ],
                                    "patching_rect": [ 29.0, 552.0, 99.0, 116.0 ],
                                    "text": "dict.pack centroid(Hz): spread(Hz): skewness(ratio): kurtosis(ratio): rolloff(Hz): flatness(dB): crest(dB):"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-65",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "bang", "int" ],
                                    "patching_rect": [ 93.5, 349.0, 29.5, 22.0 ],
                                    "text": "t b i"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-61",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 2,
                                    "outlettype": [ "", "" ],
                                    "patching_rect": [ 28.5, 476.0, 51.0, 22.0 ],
                                    "text": "zl.group"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-60",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 1,
                                    "outlettype": [ "int" ],
                                    "patching_rect": [ 93.5, 390.0, 81.5, 22.0 ],
                                    "text": "int"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-59",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "bang", "int" ],
                                    "patching_rect": [ 18.0, 262.0, 90.0, 22.0 ],
                                    "text": "t b i"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-58",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 3,
                                    "outlettype": [ "bang", "bang", "int" ],
                                    "patching_rect": [ 18.0, 308.0, 40.0, 22.0 ],
                                    "text": "uzi 7"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-55",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 1,
                                    "outlettype": [ "" ],
                                    "patching_rect": [ 18.0, 228.0, 39.0, 22.0 ],
                                    "text": "round"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-52",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "float", "bang" ],
                                    "patching_rect": [ 18.0, 108.0, 49.0, 22.0 ],
                                    "text": "t f b"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-51",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 1,
                                    "outlettype": [ "float" ],
                                    "patching_rect": [ 18.0, 188.0, 49.0, 22.0 ],
                                    "text": "* 1."
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-43",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 3,
                                    "outlettype": [ "", "", "" ],
                                    "patching_rect": [ 48.0, 158.0, 135.0, 22.0 ],
                                    "text": "getattr samps @listen 0"
                                }
                            },
                            {
                                "box": {
                                    "color": [ 1.0, 0.43921568627451, 0.662745098039216, 1.0 ],
                                    "id": "obj-42",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "float", "bang" ],
                                    "patching_rect": [ 106.0, 188.0, 203.0, 22.0 ],
                                    "text": "buffer~ stem_bass_spectral.features"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-37",
                                    "maxclass": "newobj",
                                    "numinlets": 3,
                                    "numoutlets": 1,
                                    "outlettype": [ "float" ],
                                    "patching_rect": [ 93.5, 420.0, 198.0, 22.0 ],
                                    "text": "peek~ stem_bass_spectral.features"
                                }
                            },
                            {
                                "box": {
                                    "format": 6,
                                    "id": "obj-27",
                                    "maxclass": "flonum",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "", "bang" ],
                                    "parameter_enable": 0,
                                    "patching_rect": [ 18.0, 68.0, 50.0, 22.0 ]
                                }
                            },
                            {
                                "box": {
                                    "comment": "",
                                    "id": "obj-67",
                                    "index": 1,
                                    "maxclass": "inlet",
                                    "numinlets": 0,
                                    "numoutlets": 1,
                                    "outlettype": [ "" ],
                                    "patching_rect": [ 18.0, 8.0, 30.0, 30.0 ]
                                }
                            },
                            {
                                "box": {
                                    "comment": "",
                                    "id": "obj-68",
                                    "index": 1,
                                    "maxclass": "outlet",
                                    "numinlets": 1,
                                    "numoutlets": 0,
                                    "patching_rect": [ 29.0, 681.0, 30.0, 30.0 ]
                                }
                            }
                        ],
                        "lines": [
                            {
                                "patchline": {
                                    "destination": [ "obj-2", 0 ],
                                    "midpoints": [ 91.0, 501.0, 39.0, 501.0, 39.0, 513.0, 38.0, 513.0 ],
                                    "source": [ "obj-1", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-25", 6 ],
                                    "source": [ "obj-2", 6 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-25", 5 ],
                                    "source": [ "obj-2", 5 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-25", 4 ],
                                    "source": [ "obj-2", 4 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-25", 3 ],
                                    "source": [ "obj-2", 3 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-25", 2 ],
                                    "source": [ "obj-2", 2 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-25", 1 ],
                                    "source": [ "obj-2", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-25", 0 ],
                                    "source": [ "obj-2", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-68", 0 ],
                                    "source": [ "obj-25", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-52", 0 ],
                                    "source": [ "obj-27", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-61", 0 ],
                                    "midpoints": [ 103.0, 458.0, 38.0, 458.0 ],
                                    "source": [ "obj-37", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-42", 0 ],
                                    "source": [ "obj-43", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-51", 1 ],
                                    "source": [ "obj-43", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-55", 0 ],
                                    "source": [ "obj-51", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-43", 0 ],
                                    "source": [ "obj-52", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-51", 0 ],
                                    "source": [ "obj-52", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-59", 0 ],
                                    "source": [ "obj-55", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-61", 0 ],
                                    "source": [ "obj-58", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-65", 0 ],
                                    "midpoints": [ 48.5, 339.0, 103.0, 339.0 ],
                                    "source": [ "obj-58", 2 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-58", 0 ],
                                    "source": [ "obj-59", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-60", 1 ],
                                    "midpoints": [ 98.5, 336.5, 165.5, 336.5 ],
                                    "source": [ "obj-59", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-37", 0 ],
                                    "source": [ "obj-60", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-2", 0 ],
                                    "source": [ "obj-61", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-37", 2 ],
                                    "midpoints": [ 113.5, 372.0, 282.0, 372.0 ],
                                    "source": [ "obj-65", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-60", 0 ],
                                    "midpoints": [ 103.0, 375.0, 103.0, 375.0 ],
                                    "source": [ "obj-65", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-27", 0 ],
                                    "source": [ "obj-67", 0 ]
                                }
                            }
                        ],
                        "styles": [
                            {
                                "name": "max6box",
                                "default": {
                                    "accentcolor": [ 0.8, 0.839216, 0.709804, 1.0 ],
                                    "bgcolor": [ 1.0, 1.0, 1.0, 0.5 ],
                                    "textcolor_inverse": [ 0.0, 0.0, 0.0, 1.0 ]
                                },
                                "parentstyle": "",
                                "multi": 0
                            },
                            {
                                "name": "max6inlet",
                                "default": {
                                    "color": [ 0.423529, 0.372549, 0.27451, 1.0 ]
                                },
                                "parentstyle": "",
                                "multi": 0
                            },
                            {
                                "name": "max6message",
                                "default": {
                                    "bgfillcolor": {
                                        "angle": 270.0,
                                        "autogradient": 0,
                                        "color": [ 0.290196, 0.309804, 0.301961, 1.0 ],
                                        "color1": [ 0.866667, 0.866667, 0.866667, 1.0 ],
                                        "color2": [ 0.788235, 0.788235, 0.788235, 1.0 ],
                                        "proportion": 0.39,
                                        "type": "gradient"
                                    },
                                    "textcolor_inverse": [ 0.0, 0.0, 0.0, 1.0 ]
                                },
                                "parentstyle": "max6box",
                                "multi": 0
                            },
                            {
                                "name": "max6outlet",
                                "default": {
                                    "color": [ 0.0, 0.454902, 0.498039, 1.0 ]
                                },
                                "parentstyle": "",
                                "multi": 0
                            }
                        ]
                    },
                    "patching_rect": [ 3877.6595467329025, 1268.0850973129272, 111.0, 22.0 ],
                    "text": "p \"feature lookup\""
                }
            },
            {
                "box": {
                    "bgcolor": [ 0.2, 0.2, 0.2, 0.0 ],
                    "contdata": 1,
                    "id": "obj-146",
                    "maxclass": "multislider",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "orientation": 0,
                    "outlettype": [ "", "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 3877.6595467329025, 1160.6382895708084, 310.0, 90.0 ],
                    "setminmax": [ 0.0, 1.0 ],
                    "slidercolor": [ 0.254901960784314, 0.905882352941176, 0.450980392156863, 1.0 ]
                }
            },
            {
                "box": {
                    "filename": "fluid.waveform~",
                    "id": "obj-147",
                    "maxclass": "jsui",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 3877.6595467329025, 1160.6382895708084, 311.1111259460449, 89.58333760499954 ]
                }
            },
            {
                "box": {
                    "id": "obj-144",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 4085.1063537597656, 1126.5957366228104, 229.0, 22.0 ],
                    "text": "features stem_bass_spectral.features red"
                }
            },
            {
                "box": {
                    "id": "obj-145",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 3877.6595467329025, 1126.5957366228104, 227.0, 22.0 ],
                    "text": "clear, waveform stem_bass.mono source"
                }
            },
            {
                "box": {
                    "id": "obj-142",
                    "maxclass": "dict.view",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 3201.0638068914413, 1318.0850969552994, 170.0, 150.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-143",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "dictionary" ],
                    "patcher": {
                        "fileversion": 1,
                        "appversion": {
                            "major": 9,
                            "minor": 1,
                            "revision": 4,
                            "architecture": "x64",
                            "modernui": 1
                        },
                        "classnamespace": "box",
                        "rect": [ 341.0, 132.0, 515.0, 725.0 ],
                        "boxes": [
                            {
                                "box": {
                                    "id": "obj-1",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 1,
                                    "outlettype": [ "" ],
                                    "patching_rect": [ 81.5, 476.0, 130.0, 22.0 ],
                                    "text": "loadmess 0 0 0 0 0 0 0"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-2",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 8,
                                    "outlettype": [ "", "", "", "", "", "", "", "" ],
                                    "patching_rect": [ 28.5, 517.0, 113.20833333333337, 22.0 ],
                                    "text": "unjoin 7"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-25",
                                    "linecount": 8,
                                    "maxclass": "newobj",
                                    "numinlets": 8,
                                    "numoutlets": 1,
                                    "outlettype": [ "dictionary" ],
                                    "patching_rect": [ 29.0, 552.0, 99.0, 116.0 ],
                                    "text": "dict.pack centroid(Hz): spread(Hz): skewness(ratio): kurtosis(ratio): rolloff(Hz): flatness(dB): crest(dB):"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-65",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "bang", "int" ],
                                    "patching_rect": [ 93.5, 349.0, 29.5, 22.0 ],
                                    "text": "t b i"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-61",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 2,
                                    "outlettype": [ "", "" ],
                                    "patching_rect": [ 28.5, 476.0, 51.0, 22.0 ],
                                    "text": "zl.group"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-60",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 1,
                                    "outlettype": [ "int" ],
                                    "patching_rect": [ 93.5, 390.0, 81.5, 22.0 ],
                                    "text": "int"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-59",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "bang", "int" ],
                                    "patching_rect": [ 18.0, 262.0, 90.0, 22.0 ],
                                    "text": "t b i"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-58",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 3,
                                    "outlettype": [ "bang", "bang", "int" ],
                                    "patching_rect": [ 18.0, 308.0, 40.0, 22.0 ],
                                    "text": "uzi 7"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-55",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 1,
                                    "outlettype": [ "" ],
                                    "patching_rect": [ 18.0, 228.0, 39.0, 22.0 ],
                                    "text": "round"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-52",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "float", "bang" ],
                                    "patching_rect": [ 18.0, 108.0, 49.0, 22.0 ],
                                    "text": "t f b"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-51",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 1,
                                    "outlettype": [ "float" ],
                                    "patching_rect": [ 18.0, 188.0, 49.0, 22.0 ],
                                    "text": "* 1."
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-43",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 3,
                                    "outlettype": [ "", "", "" ],
                                    "patching_rect": [ 48.0, 158.0, 135.0, 22.0 ],
                                    "text": "getattr samps @listen 0"
                                }
                            },
                            {
                                "box": {
                                    "color": [ 1.0, 0.43921568627451, 0.662745098039216, 1.0 ],
                                    "id": "obj-42",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "float", "bang" ],
                                    "patching_rect": [ 106.0, 188.0, 211.0, 22.0 ],
                                    "text": "buffer~ stem_drums_spectral.features"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-37",
                                    "maxclass": "newobj",
                                    "numinlets": 3,
                                    "numoutlets": 1,
                                    "outlettype": [ "float" ],
                                    "patching_rect": [ 93.5, 420.0, 206.0, 22.0 ],
                                    "text": "peek~ stem_drums_spectral.features"
                                }
                            },
                            {
                                "box": {
                                    "format": 6,
                                    "id": "obj-27",
                                    "maxclass": "flonum",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "", "bang" ],
                                    "parameter_enable": 0,
                                    "patching_rect": [ 18.0, 68.0, 50.0, 22.0 ]
                                }
                            },
                            {
                                "box": {
                                    "comment": "",
                                    "id": "obj-67",
                                    "index": 1,
                                    "maxclass": "inlet",
                                    "numinlets": 0,
                                    "numoutlets": 1,
                                    "outlettype": [ "" ],
                                    "patching_rect": [ 18.0, 8.0, 30.0, 30.0 ]
                                }
                            },
                            {
                                "box": {
                                    "comment": "",
                                    "id": "obj-68",
                                    "index": 1,
                                    "maxclass": "outlet",
                                    "numinlets": 1,
                                    "numoutlets": 0,
                                    "patching_rect": [ 29.0, 681.0, 30.0, 30.0 ]
                                }
                            }
                        ],
                        "lines": [
                            {
                                "patchline": {
                                    "destination": [ "obj-2", 0 ],
                                    "midpoints": [ 91.0, 501.0, 39.0, 501.0, 39.0, 513.0, 38.0, 513.0 ],
                                    "source": [ "obj-1", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-25", 6 ],
                                    "source": [ "obj-2", 6 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-25", 5 ],
                                    "source": [ "obj-2", 5 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-25", 4 ],
                                    "source": [ "obj-2", 4 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-25", 3 ],
                                    "source": [ "obj-2", 3 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-25", 2 ],
                                    "source": [ "obj-2", 2 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-25", 1 ],
                                    "source": [ "obj-2", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-25", 0 ],
                                    "source": [ "obj-2", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-68", 0 ],
                                    "source": [ "obj-25", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-52", 0 ],
                                    "source": [ "obj-27", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-61", 0 ],
                                    "midpoints": [ 103.0, 458.0, 38.0, 458.0 ],
                                    "source": [ "obj-37", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-42", 0 ],
                                    "source": [ "obj-43", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-51", 1 ],
                                    "source": [ "obj-43", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-55", 0 ],
                                    "source": [ "obj-51", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-43", 0 ],
                                    "source": [ "obj-52", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-51", 0 ],
                                    "source": [ "obj-52", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-59", 0 ],
                                    "source": [ "obj-55", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-61", 0 ],
                                    "source": [ "obj-58", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-65", 0 ],
                                    "midpoints": [ 48.5, 339.0, 103.0, 339.0 ],
                                    "source": [ "obj-58", 2 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-58", 0 ],
                                    "source": [ "obj-59", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-60", 1 ],
                                    "midpoints": [ 98.5, 336.5, 165.5, 336.5 ],
                                    "source": [ "obj-59", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-37", 0 ],
                                    "source": [ "obj-60", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-2", 0 ],
                                    "source": [ "obj-61", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-37", 2 ],
                                    "midpoints": [ 113.5, 372.0, 290.0, 372.0 ],
                                    "source": [ "obj-65", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-60", 0 ],
                                    "midpoints": [ 103.0, 375.0, 103.0, 375.0 ],
                                    "source": [ "obj-65", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-27", 0 ],
                                    "source": [ "obj-67", 0 ]
                                }
                            }
                        ],
                        "styles": [
                            {
                                "name": "max6box",
                                "default": {
                                    "accentcolor": [ 0.8, 0.839216, 0.709804, 1.0 ],
                                    "bgcolor": [ 1.0, 1.0, 1.0, 0.5 ],
                                    "textcolor_inverse": [ 0.0, 0.0, 0.0, 1.0 ]
                                },
                                "parentstyle": "",
                                "multi": 0
                            },
                            {
                                "name": "max6inlet",
                                "default": {
                                    "color": [ 0.423529, 0.372549, 0.27451, 1.0 ]
                                },
                                "parentstyle": "",
                                "multi": 0
                            },
                            {
                                "name": "max6message",
                                "default": {
                                    "bgfillcolor": {
                                        "angle": 270.0,
                                        "autogradient": 0,
                                        "color": [ 0.290196, 0.309804, 0.301961, 1.0 ],
                                        "color1": [ 0.866667, 0.866667, 0.866667, 1.0 ],
                                        "color2": [ 0.788235, 0.788235, 0.788235, 1.0 ],
                                        "proportion": 0.39,
                                        "type": "gradient"
                                    },
                                    "textcolor_inverse": [ 0.0, 0.0, 0.0, 1.0 ]
                                },
                                "parentstyle": "max6box",
                                "multi": 0
                            },
                            {
                                "name": "max6outlet",
                                "default": {
                                    "color": [ 0.0, 0.454902, 0.498039, 1.0 ]
                                },
                                "parentstyle": "",
                                "multi": 0
                            }
                        ]
                    },
                    "patching_rect": [ 3201.0638068914413, 1279.7872248888016, 111.0, 22.0 ],
                    "text": "p \"feature lookup\""
                }
            },
            {
                "box": {
                    "bgcolor": [ 0.2, 0.2, 0.2, 0.0 ],
                    "contdata": 1,
                    "id": "obj-140",
                    "maxclass": "multislider",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "orientation": 0,
                    "outlettype": [ "", "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 3201.0638068914413, 1172.3404171466827, 310.0, 90.0 ],
                    "setminmax": [ 0.0, 1.0 ],
                    "slidercolor": [ 0.254901960784314, 0.905882352941176, 0.450980392156863, 1.0 ]
                }
            },
            {
                "box": {
                    "filename": "fluid.waveform~",
                    "id": "obj-141",
                    "maxclass": "jsui",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 3196.8084877729416, 1172.3404171466827, 311.1111259460449, 89.58333760499954 ]
                }
            },
            {
                "box": {
                    "id": "obj-138",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 3412.765933036804, 1137.2340344190598, 242.10527181625366, 22.0 ],
                    "text": "features stem_drums_spectral.features red"
                }
            },
            {
                "box": {
                    "id": "obj-139",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 3196.8084877729416, 1137.2340344190598, 235.0, 22.0 ],
                    "text": "clear, waveform stem_drums.mono source"
                }
            },
            {
                "box": {
                    "color": [ 1.0, 0.0, 0.0, 1.0 ],
                    "id": "obj-137",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 4735.106349110603, 264.8936151266098, 203.0, 22.0 ],
                    "text": "buffer~ stem_melo_spectral.features"
                }
            },
            {
                "box": {
                    "color": [ 1.0, 0.0, 0.0, 1.0 ],
                    "id": "obj-130",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 4024.468056321144, 264.8936151266098, 203.0, 22.0 ],
                    "text": "buffer~ stem_bass_spectral.features"
                }
            },
            {
                "box": {
                    "color": [ 1.0, 0.0, 0.0, 1.0 ],
                    "id": "obj-129",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 3358.5106142759323, 264.8936151266098, 211.0, 22.0 ],
                    "text": "buffer~ stem_drums_spectral.features"
                }
            },
            {
                "box": {
                    "id": "obj-128",
                    "maxclass": "dict.view",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 2581.914875149727, 1318.0850969552994, 170.0, 150.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-69",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "dictionary" ],
                    "patcher": {
                        "fileversion": 1,
                        "appversion": {
                            "major": 9,
                            "minor": 1,
                            "revision": 4,
                            "architecture": "x64",
                            "modernui": 1
                        },
                        "classnamespace": "box",
                        "rect": [ 341.0, 132.0, 515.0, 725.0 ],
                        "boxes": [
                            {
                                "box": {
                                    "id": "obj-1",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 1,
                                    "outlettype": [ "" ],
                                    "patching_rect": [ 81.5, 476.0, 130.0, 22.0 ],
                                    "text": "loadmess 0 0 0 0 0 0 0"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-2",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 8,
                                    "outlettype": [ "", "", "", "", "", "", "", "" ],
                                    "patching_rect": [ 28.5, 517.0, 113.20833333333337, 22.0 ],
                                    "text": "unjoin 7"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-25",
                                    "linecount": 8,
                                    "maxclass": "newobj",
                                    "numinlets": 8,
                                    "numoutlets": 1,
                                    "outlettype": [ "dictionary" ],
                                    "patching_rect": [ 29.0, 552.0, 99.0, 116.0 ],
                                    "text": "dict.pack centroid(Hz): spread(Hz): skewness(ratio): kurtosis(ratio): rolloff(Hz): flatness(dB): crest(dB):"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-65",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "bang", "int" ],
                                    "patching_rect": [ 93.5, 349.0, 29.5, 22.0 ],
                                    "text": "t b i"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-61",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 2,
                                    "outlettype": [ "", "" ],
                                    "patching_rect": [ 28.5, 476.0, 51.0, 22.0 ],
                                    "text": "zl.group"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-60",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 1,
                                    "outlettype": [ "int" ],
                                    "patching_rect": [ 93.5, 390.0, 81.5, 22.0 ],
                                    "text": "int"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-59",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "bang", "int" ],
                                    "patching_rect": [ 18.0, 262.0, 90.0, 22.0 ],
                                    "text": "t b i"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-58",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 3,
                                    "outlettype": [ "bang", "bang", "int" ],
                                    "patching_rect": [ 18.0, 308.0, 40.0, 22.0 ],
                                    "text": "uzi 7"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-55",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 1,
                                    "outlettype": [ "" ],
                                    "patching_rect": [ 18.0, 228.0, 39.0, 22.0 ],
                                    "text": "round"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-52",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "float", "bang" ],
                                    "patching_rect": [ 18.0, 108.0, 49.0, 22.0 ],
                                    "text": "t f b"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-51",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 1,
                                    "outlettype": [ "float" ],
                                    "patching_rect": [ 18.0, 188.0, 49.0, 22.0 ],
                                    "text": "* 1."
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-43",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 3,
                                    "outlettype": [ "", "", "" ],
                                    "patching_rect": [ 48.0, 158.0, 135.0, 22.0 ],
                                    "text": "getattr samps @listen 0"
                                }
                            },
                            {
                                "box": {
                                    "color": [ 1.0, 0.43921568627451, 0.662745098039216, 1.0 ],
                                    "id": "obj-42",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "float", "bang" ],
                                    "patching_rect": [ 106.0, 188.0, 211.0, 22.0 ],
                                    "text": "buffer~ stem_vocals_spectral.features"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-37",
                                    "maxclass": "newobj",
                                    "numinlets": 3,
                                    "numoutlets": 1,
                                    "outlettype": [ "float" ],
                                    "patching_rect": [ 93.5, 420.0, 207.0, 22.0 ],
                                    "text": "peek~ stem_vocals_spectral.features"
                                }
                            },
                            {
                                "box": {
                                    "format": 6,
                                    "id": "obj-27",
                                    "maxclass": "flonum",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "", "bang" ],
                                    "parameter_enable": 0,
                                    "patching_rect": [ 18.0, 68.0, 50.0, 22.0 ]
                                }
                            },
                            {
                                "box": {
                                    "comment": "",
                                    "id": "obj-67",
                                    "index": 1,
                                    "maxclass": "inlet",
                                    "numinlets": 0,
                                    "numoutlets": 1,
                                    "outlettype": [ "" ],
                                    "patching_rect": [ 18.0, 8.0, 30.0, 30.0 ]
                                }
                            },
                            {
                                "box": {
                                    "comment": "",
                                    "id": "obj-68",
                                    "index": 1,
                                    "maxclass": "outlet",
                                    "numinlets": 1,
                                    "numoutlets": 0,
                                    "patching_rect": [ 29.0, 681.0, 30.0, 30.0 ]
                                }
                            }
                        ],
                        "lines": [
                            {
                                "patchline": {
                                    "destination": [ "obj-2", 0 ],
                                    "midpoints": [ 91.0, 501.0, 39.0, 501.0, 39.0, 513.0, 38.0, 513.0 ],
                                    "source": [ "obj-1", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-25", 6 ],
                                    "source": [ "obj-2", 6 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-25", 5 ],
                                    "source": [ "obj-2", 5 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-25", 4 ],
                                    "source": [ "obj-2", 4 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-25", 3 ],
                                    "source": [ "obj-2", 3 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-25", 2 ],
                                    "source": [ "obj-2", 2 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-25", 1 ],
                                    "source": [ "obj-2", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-25", 0 ],
                                    "source": [ "obj-2", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-68", 0 ],
                                    "source": [ "obj-25", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-52", 0 ],
                                    "source": [ "obj-27", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-61", 0 ],
                                    "midpoints": [ 103.0, 458.0, 38.0, 458.0 ],
                                    "source": [ "obj-37", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-42", 0 ],
                                    "source": [ "obj-43", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-51", 1 ],
                                    "source": [ "obj-43", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-55", 0 ],
                                    "source": [ "obj-51", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-43", 0 ],
                                    "source": [ "obj-52", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-51", 0 ],
                                    "source": [ "obj-52", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-59", 0 ],
                                    "source": [ "obj-55", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-61", 0 ],
                                    "source": [ "obj-58", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-65", 0 ],
                                    "midpoints": [ 48.5, 339.0, 103.0, 339.0 ],
                                    "source": [ "obj-58", 2 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-58", 0 ],
                                    "source": [ "obj-59", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-60", 1 ],
                                    "midpoints": [ 98.5, 336.5, 165.5, 336.5 ],
                                    "source": [ "obj-59", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-37", 0 ],
                                    "source": [ "obj-60", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-2", 0 ],
                                    "source": [ "obj-61", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-37", 2 ],
                                    "midpoints": [ 113.5, 372.0, 291.0, 372.0 ],
                                    "source": [ "obj-65", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-60", 0 ],
                                    "midpoints": [ 103.0, 375.0, 103.0, 375.0 ],
                                    "source": [ "obj-65", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-27", 0 ],
                                    "source": [ "obj-67", 0 ]
                                }
                            }
                        ],
                        "styles": [
                            {
                                "name": "max6box",
                                "default": {
                                    "accentcolor": [ 0.8, 0.839216, 0.709804, 1.0 ],
                                    "bgcolor": [ 1.0, 1.0, 1.0, 0.5 ],
                                    "textcolor_inverse": [ 0.0, 0.0, 0.0, 1.0 ]
                                },
                                "parentstyle": "",
                                "multi": 0
                            },
                            {
                                "name": "max6inlet",
                                "default": {
                                    "color": [ 0.423529, 0.372549, 0.27451, 1.0 ]
                                },
                                "parentstyle": "",
                                "multi": 0
                            },
                            {
                                "name": "max6message",
                                "default": {
                                    "bgfillcolor": {
                                        "angle": 270.0,
                                        "autogradient": 0,
                                        "color": [ 0.290196, 0.309804, 0.301961, 1.0 ],
                                        "color1": [ 0.866667, 0.866667, 0.866667, 1.0 ],
                                        "color2": [ 0.788235, 0.788235, 0.788235, 1.0 ],
                                        "proportion": 0.39,
                                        "type": "gradient"
                                    },
                                    "textcolor_inverse": [ 0.0, 0.0, 0.0, 1.0 ]
                                },
                                "parentstyle": "max6box",
                                "multi": 0
                            },
                            {
                                "name": "max6outlet",
                                "default": {
                                    "color": [ 0.0, 0.454902, 0.498039, 1.0 ]
                                },
                                "parentstyle": "",
                                "multi": 0
                            }
                        ]
                    },
                    "patching_rect": [ 2581.914875149727, 1287.2340333461761, 111.0, 22.0 ],
                    "text": "p \"feature lookup\""
                }
            },
            {
                "box": {
                    "bgcolor": [ 0.2, 0.2, 0.2, 0.0 ],
                    "contdata": 1,
                    "id": "obj-118",
                    "maxclass": "multislider",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "orientation": 0,
                    "outlettype": [ "", "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 2581.914875149727, 1179.7872256040573, 310.0, 90.0 ],
                    "setminmax": [ 0.0, 1.0 ],
                    "slidercolor": [ 0.254901960784314, 0.905882352941176, 0.450980392156863, 1.0 ]
                }
            },
            {
                "box": {
                    "filename": "fluid.waveform~",
                    "id": "obj-127",
                    "maxclass": "jsui",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 2574.4680666923523, 1179.7872256040573, 311.1111259460449, 89.58333760499954 ]
                }
            },
            {
                "box": {
                    "id": "obj-117",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2581.914875149727, 1137.2340344190598, 238.0, 22.0 ],
                    "text": "features stem_vocals_spectral.features red"
                }
            },
            {
                "box": {
                    "id": "obj-115",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2839.361681818962, 1137.2340344190598, 196.0, 22.0 ],
                    "text": "clear, waveform stem_vocals.mono"
                }
            },
            {
                "box": {
                    "color": [ 1.0, 0.0, 0.0, 1.0 ],
                    "id": "obj-108",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 2755.319129228592, 260.63829600811005, 227.92474591732025, 22.0 ],
                    "text": "buffer~ stem_vocals_spectral.features"
                }
            },
            {
                "box": {
                    "id": "obj-106",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 3201.0638068914413, 826.5957387685776, 244.0, 22.0 ],
                    "text": "slices stem_drums.slices stem_drums.mono"
                }
            },
            {
                "box": {
                    "id": "obj-107",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 3455.3191242218018, 826.5957387685776, 195.0, 22.0 ],
                    "text": "clear, waveform stem_drums.mono"
                }
            },
            {
                "box": {
                    "filename": "fluid.waveform~",
                    "id": "obj-104",
                    "maxclass": "jsui",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 3208.510615348816, 879.7872277498245, 296.3414704799652, 101.88230270147324 ]
                }
            },
            {
                "box": {
                    "color": [ 1.0, 0.0, 0.0, 1.0 ],
                    "id": "obj-103",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 3358.5106142759323, 237.2340408563614, 149.0, 22.0 ],
                    "text": "buffer~ stem_drums.slices"
                }
            },
            {
                "box": {
                    "filename": "fluid.waveform~",
                    "id": "obj-99",
                    "maxclass": "jsui",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 3885.106355190277, 879.7872277498245, 296.3414704799652, 101.88230270147324 ]
                }
            },
            {
                "box": {
                    "id": "obj-96",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 3885.106355190277, 826.5957387685776, 228.0, 22.0 ],
                    "text": "slices stem_bass.slices stem_bass.mono"
                }
            },
            {
                "box": {
                    "id": "obj-97",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 4124.468055605888, 826.5957387685776, 187.0, 22.0 ],
                    "text": "clear, waveform stem_bass.mono"
                }
            },
            {
                "box": {
                    "color": [ 1.0, 0.0, 0.0, 1.0 ],
                    "id": "obj-95",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 4027.659545660019, 237.2340408563614, 141.0, 22.0 ],
                    "text": "buffer~ stem_bass.slices"
                }
            },
            {
                "box": {
                    "color": [ 1.0, 0.0, 0.0, 1.0 ],
                    "id": "obj-92",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 4739.361668229103, 237.2340408563614, 141.0, 22.0 ],
                    "text": "buffer~ stem_melo.slices"
                }
            },
            {
                "box": {
                    "id": "obj-89",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 4546.808478116989, 837.234036564827, 229.0, 22.0 ],
                    "text": "slices stem_melo.slices stem_melo.mono"
                }
            },
            {
                "box": {
                    "id": "obj-90",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 4781.914859414101, 837.234036564827, 188.0, 22.0 ],
                    "text": "clear, waveform stem_melo.mono"
                }
            },
            {
                "box": {
                    "filename": "fluid.waveform~",
                    "id": "obj-88",
                    "maxclass": "jsui",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 4546.808478116989, 872.34041929245, 296.3414704799652, 101.88230270147324 ]
                }
            },
            {
                "box": {
                    "id": "obj-71",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2581.914875149727, 829.7872281074524, 245.0, 22.0 ],
                    "text": "slices stem_vocals.slices stem_vocals.mono"
                }
            },
            {
                "box": {
                    "id": "obj-70",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2827.6595542430878, 829.7872281074524, 196.0, 22.0 ],
                    "text": "clear, waveform stem_vocals.mono"
                }
            },
            {
                "box": {
                    "filename": "fluid.waveform~",
                    "id": "obj-22",
                    "maxclass": "jsui",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 2581.914875149727, 879.7872277498245, 309.04251365661617, 99.99999642372131 ]
                }
            },
            {
                "box": {
                    "color": [ 1.0, 0.0, 0.0, 1.0 ],
                    "id": "obj-68",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 2755.319129228592, 237.2340408563614, 163.10000336170197, 22.0 ],
                    "text": "buffer~ stem_vocals.slices"
                }
            },
            {
                "box": {
                    "id": "obj-4002",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 334.48277616500854, 427.5862293243408, 155.0, 22.0 ],
                    "text": "prepend set_track_name"
                }
            },
            {
                "box": {
                    "id": "obj-41",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 824.1379742622375, 189.65518236160278, 29.5, 22.0 ],
                    "text": "0."
                }
            },
            {
                "box": {
                    "id": "obj-39",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "int" ],
                    "patching_rect": [ 824.1379742622375, 231.03449487686157, 29.5, 22.0 ],
                    "text": "+ 1"
                }
            },
            {
                "box": {
                    "id": "obj-38",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 886.2069430351257, 189.65518236160278, 45.0, 22.0 ],
                    "text": "reset 1"
                }
            },
            {
                "box": {
                    "id": "obj-36",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 886.2069430351257, 231.03449487686157, 29.5, 22.0 ],
                    "text": "1"
                }
            },
            {
                "box": {
                    "id": "obj-33",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 810.3448700904846, 272.41380739212036, 29.5, 22.0 ],
                    "text": "1"
                }
            },
            {
                "box": {
                    "id": "obj-11",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 168.9655261039734, 189.65518236160278, 39.0, 22.0 ],
                    "text": "query"
                }
            },
            {
                "box": {
                    "id": "obj-8",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 4,
                    "outlettype": [ "bang", "bang", "bang", "bang" ],
                    "patching_rect": [ 220.68966674804688, 151.72414588928223, 52.0, 22.0 ],
                    "text": "t b b b b"
                }
            },
            {
                "box": {
                    "id": "obj-5",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 168.9655261039734, 231.03449487686157, 44.0, 22.0 ],
                    "text": "line $1"
                }
            },
            {
                "box": {
                    "bubble_outlinecolor": [ 1.0, 1.0, 1.0, 1.0 ],
                    "fontface": 1,
                    "id": "obj-1",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 124.13793754577637, 51.724140644073486, 258.0, 20.0 ],
                    "text": "EBYS — OFFLINE ANALYZER + PLAYBACK",
                    "textcolor": [ 1.0, 1.0, 1.0, 1.0 ]
                }
            },
            {
                "box": {
                    "fontface": 1,
                    "id": "obj-9",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 131.03448963165283, 79.31034898757935, 101.0, 20.0 ],
                    "text": "== LOADING ==",
                    "textcolor": [ 1.0, 1.0, 1.0, 1.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-13",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 231.03449487686157, 113.79310941696167, 113.0, 22.0 ],
                    "saved_object_attributes": {
                        "filename": "streamWatcher.js",
                        "parameter_enable": 0
                    },
                    "text": "js streamWatcher.js"
                }
            },
            {
                "box": {
                    "id": "obj-14",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 220.68966674804688, 189.65518236160278, 342.0, 22.0 ],
                    "text": "read /Users/alexandregagne/Documents/EBYS/data/stream.txt"
                }
            },
            {
                "box": {
                    "id": "obj-15",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 3,
                    "outlettype": [ "", "bang", "int" ],
                    "patching_rect": [ 220.68966674804688, 231.03449487686157, 80.0, 22.0 ],
                    "text": "text"
                }
            },
            {
                "box": {
                    "id": "obj-16",
                    "maxclass": "newobj",
                    "numinlets": 5,
                    "numoutlets": 4,
                    "outlettype": [ "int", "", "", "int" ],
                    "patching_rect": [ 682.75865650177, 189.65518236160278, 79.3370310664177, 22.0 ],
                    "text": "counter 1 4"
                }
            },
            {
                "box": {
                    "id": "obj-27",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 5,
                    "outlettype": [ "", "", "", "", "" ],
                    "patching_rect": [ 220.68966674804688, 275.8620834350586, 87.78540849685669, 22.0 ],
                    "saved_object_attributes": {
                        "legacyoutputorder": 0
                    },
                    "text": "regexp (/.+)"
                }
            },
            {
                "box": {
                    "id": "obj-30",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 5,
                    "outlettype": [ "", "", "", "", "" ],
                    "patching_rect": [ 334.48277616500854, 400.00002098083496, 92.9116638302803, 22.0 ],
                    "saved_object_attributes": {
                        "legacyoutputorder": 0
                    },
                    "text": "regexp [^/]+$"
                }
            },
            {
                "box": {
                    "color": [ 0.431372549019608, 0.431372549019608, 0.431372549019608, 1.0 ],
                    "id": "obj-100",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 2570.2127475738525, 237.2340408563614, 152.43855858445164, 22.0 ],
                    "saved_attribute_attributes": {
                        "color": {
                            "expression": "themecolor.live_surface_frame_focus"
                        }
                    },
                    "saved_newobj_attribute_attributes": {
                        "color": {
                            "expression": "themecolor.live_surface_frame_focus"
                        }
                    },
                    "text": "buffer~ stem_vocals"
                }
            },
            {
                "box": {
                    "id": "obj-190",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 2570.2127475738525, 218.0851048231125, 100.0, 20.0 ],
                    "text": "vocals"
                }
            },
            {
                "box": {
                    "color": [ 0.431372549019608, 0.431372549019608, 0.431372549019608, 1.0 ],
                    "id": "obj-200",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 4546.808478116989, 237.2340408563614, 138.4, 22.0 ],
                    "saved_attribute_attributes": {
                        "color": {
                            "expression": "themecolor.live_surface_frame_focus"
                        }
                    },
                    "saved_newobj_attribute_attributes": {
                        "color": {
                            "expression": "themecolor.live_surface_frame_focus"
                        }
                    },
                    "text": "buffer~ stem_melo"
                }
            },
            {
                "box": {
                    "id": "obj-290",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 4539.361669659615, 214.89361548423767, 100.0, 20.0 ],
                    "text": "melody"
                }
            },
            {
                "box": {
                    "color": [ 0.431372549019608, 0.431372549019608, 0.431372549019608, 1.0 ],
                    "id": "obj-300",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 3827.6595470905304, 237.2340408563614, 138.4, 22.0 ],
                    "saved_attribute_attributes": {
                        "color": {
                            "expression": "themecolor.live_surface_frame_focus"
                        }
                    },
                    "saved_newobj_attribute_attributes": {
                        "color": {
                            "expression": "themecolor.live_surface_frame_focus"
                        }
                    },
                    "text": "buffer~ stem_bass"
                }
            },
            {
                "box": {
                    "id": "obj-390",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 3824.4680577516556, 210.63829636573792, 100.0, 20.0 ],
                    "text": "bass"
                }
            },
            {
                "box": {
                    "color": [ 0.431372549019608, 0.431372549019608, 0.431372549019608, 1.0 ],
                    "id": "obj-400",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 3165.9574241638184, 237.2340408563614, 115.0, 22.0 ],
                    "saved_attribute_attributes": {
                        "color": {
                            "expression": "themecolor.live_surface_frame_focus"
                        }
                    },
                    "saved_newobj_attribute_attributes": {
                        "color": {
                            "expression": "themecolor.live_surface_frame_focus"
                        }
                    },
                    "text": "buffer~ stem_drums"
                }
            },
            {
                "box": {
                    "id": "obj-490",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 3165.9574241638184, 218.0851048231125, 100.0, 20.0 ],
                    "text": "drums"
                }
            },
            {
                "box": {
                    "fontface": 1,
                    "id": "obj-35",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 2570.2127475738525, 191.489360332489, 164.0, 20.0 ],
                    "text": "== OFFLINE ANALYSIS =="
                }
            },
            {
                "box": {
                    "id": "obj-110",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 10,
                    "outlettype": [ "float", "list", "float", "float", "float", "float", "float", "", "int", "" ],
                    "patching_rect": [ 2565.957428455353, 518.0851026773453, 138.4, 22.0 ],
                    "text": "info~ stem_vocals"
                }
            },
            {
                "box": {
                    "id": "obj-112",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2785.10636305809, 491.4893581867218, 138.34445520639417, 22.0 ],
                    "text": "prepend vocals"
                }
            },
            {
                "box": {
                    "id": "obj-113",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2785.10636305809, 518.0851026773453, 138.0, 22.0 ],
                    "text": "prepend setStemDurMs"
                }
            },
            {
                "box": {
                    "id": "obj-131",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 2581.914875149727, 706.3829736709595, 100.0, 20.0 ],
                    "text": "Analyze"
                }
            },
            {
                "box": {
                    "id": "obj-132",
                    "linecount": 4,
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 2574.4680666923523, 734.0425479412079, 383.5454465150833, 62.0 ],
                    "text": "fluid.bufampslice~ @source stem_vocals.mono @indices stem_vocals.slices @highpassfreq 150 @floor -55 @fastrampup 3 @fastrampdown 383 @slowrampup 2205 @slowrampdown 2205 @minslicelength 11025 @onthreshold 20 @offthreshold 8"
                }
            },
            {
                "box": {
                    "id": "obj-133",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 2574.4680666923523, 1048.9361627101898, 478.0, 22.0 ],
                    "text": "fluid.bufspectralshape~ @source stem_vocals @features stem_vocals_spectral.features"
                }
            },
            {
                "box": {
                    "id": "obj-134",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 2574.4680666923523, 1529.7872231006622, 432.0, 22.0 ],
                    "text": "fluid.bufloudness~ @source stem_vocals @features stem_vocals_loud.features"
                }
            },
            {
                "box": {
                    "id": "obj-135",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 2570.2127475738525, 2095.7446658611298, 445.0, 22.0 ],
                    "text": "fluid.bufpitch~ @source stem_vocals.mono @features stem_vocals_pitch.features"
                }
            },
            {
                "box": {
                    "id": "obj-136",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2570.2127475738525, 3091.4893395900726, 86.0, 22.0 ],
                    "text": "readVocals"
                }
            },
            {
                "box": {
                    "id": "obj-210",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 10,
                    "outlettype": [ "float", "list", "float", "float", "float", "float", "float", "", "int", "" ],
                    "patching_rect": [ 4546.808478116989, 514.8936133384705, 124.0, 22.0 ],
                    "text": "info~ stem_melo"
                }
            },
            {
                "box": {
                    "id": "obj-212",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 4739.361668229103, 491.4893581867218, 103.49650454521179, 22.0 ],
                    "text": "prepend melody"
                }
            },
            {
                "box": {
                    "id": "obj-213",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 4739.361668229103, 514.8936133384705, 146.8531483411789, 22.0 ],
                    "text": "prepend setStemDurMs"
                }
            },
            {
                "box": {
                    "id": "obj-231",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 4546.808478116989, 703.1914843320847, 100.0, 20.0 ],
                    "text": "Analyze"
                }
            },
            {
                "box": {
                    "id": "obj-232",
                    "linecount": 4,
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 4546.808478116989, 726.5957394838333, 409.52380561828613, 62.0 ],
                    "text": "fluid.bufampslice~ @source stem_melo.mono @indices stem_melo.slices @highpassfreq 150 @floor -55 @fastrampup 3 @fastrampdown 383 @slowrampup 2205 @slowrampdown 2205 @minslicelength 8820 @onthreshold 16 @offthreshold 7"
                }
            },
            {
                "box": {
                    "id": "obj-233",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 4546.808478116989, 1048.9361627101898, 495.0, 22.0 ],
                    "text": "fluid.bufspectralshape~ @source stem_melo.mono @features stem_melo_spectral.features"
                }
            },
            {
                "box": {
                    "id": "obj-234",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 4535.106350541115, 1522.3404146432877, 486.0, 22.0 ],
                    "text": "fluid.bufloudness~ @source stem_melo.mono @features stem_melo_loud.features"
                }
            },
            {
                "box": {
                    "id": "obj-236",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 4539.361669659615, 3087.234020471573, 71.6, 22.0 ],
                    "text": "readMelo"
                }
            },
            {
                "box": {
                    "id": "obj-310",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 10,
                    "outlettype": [ "float", "list", "float", "float", "float", "float", "float", "", "int", "" ],
                    "patching_rect": [ 3824.4680577516556, 518.0851026773453, 124.0, 22.0 ],
                    "text": "info~ stem_bass"
                }
            },
            {
                "box": {
                    "id": "obj-312",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 4024.468056321144, 491.4893581867218, 88.11188900470734, 22.0 ],
                    "text": "prepend bass"
                }
            },
            {
                "box": {
                    "id": "obj-313",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 4024.468056321144, 518.0851026773453, 143.35664480924606, 22.0 ],
                    "text": "prepend setStemDurMs"
                }
            },
            {
                "box": {
                    "id": "obj-331",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 3881.9148658514023, 703.1914843320847, 100.0, 20.0 ],
                    "text": "Analyze"
                }
            },
            {
                "box": {
                    "id": "obj-332",
                    "linecount": 4,
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 3881.9148658514023, 726.5957394838333, 422.6190435886383, 62.0 ],
                    "text": "fluid.bufampslice~ @source stem_bass.mono @indices stem_bass.slices @highpassfreq 40 @floor -55 @fastrampup 3 @fastrampdown 383 @slowrampup 2205 @slowrampdown 2205 @minslicelength 8820 @onthreshold 10 @offthreshold 5"
                }
            },
            {
                "box": {
                    "id": "obj-333",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 3881.9148658514023, 1048.9361627101898, 494.0, 22.0 ],
                    "text": "fluid.bufspectralshape~ @source stem_bass.mono @features stem_bass_spectral.features"
                }
            },
            {
                "box": {
                    "id": "obj-334",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 3877.6595467329025, 1522.3404146432877, 448.0, 22.0 ],
                    "text": "fluid.bufloudness~ @source stem_bass.mono @features stem_bass_loud.features"
                }
            },
            {
                "box": {
                    "id": "obj-336",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 3870.212738275528, 3087.234020471573, 71.6, 22.0 ],
                    "text": "readBass"
                }
            },
            {
                "box": {
                    "id": "obj-410",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 10,
                    "outlettype": [ "float", "list", "float", "float", "float", "float", "float", "", "int", "" ],
                    "patching_rect": [ 3170.212743282318, 518.0851026773453, 113.5, 22.0 ],
                    "text": "info~ stem_drums"
                }
            },
            {
                "box": {
                    "id": "obj-412",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 3358.5106142759323, 491.4893581867218, 96.50349748134613, 22.0 ],
                    "text": "prepend drums"
                }
            },
            {
                "box": {
                    "id": "obj-413",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 3358.5106142759323, 518.0851026773453, 141.95804339647293, 22.0 ],
                    "text": "prepend setStemDurMs"
                }
            },
            {
                "box": {
                    "id": "obj-431",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 3201.0638068914413, 703.1914843320847, 100.0, 20.0 ],
                    "text": "Analyze"
                }
            },
            {
                "box": {
                    "id": "obj-432",
                    "linecount": 4,
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 3201.0638068914413, 734.0425479412079, 389.2857105731964, 62.0 ],
                    "text": "fluid.bufampslice~ @source stem_drums.mono @indices stem_drums.slices @highpassfreq 200 @floor -55 @fastrampup 3 @fastrampdown 383 @slowrampup 2205 @slowrampdown 2205 @minslicelength 4410 @onthreshold 14 @offthreshold 7"
                }
            },
            {
                "box": {
                    "id": "obj-433",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 3201.0638068914413, 1048.9361627101898, 510.0, 22.0 ],
                    "text": "fluid.bufspectralshape~ @source stem_drums.mono @features stem_drums_spectral.features"
                }
            },
            {
                "box": {
                    "id": "obj-434",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 3208.510615348816, 1526.5957337617874, 464.0, 22.0 ],
                    "text": "fluid.bufloudness~ @source stem_drums.mono @features stem_drums_loud.features"
                }
            },
            {
                "box": {
                    "id": "obj-436",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 3193.6169984340668, 3087.234020471573, 68.0, 22.0 ],
                    "text": "readDrums"
                }
            },
            {
                "box": {
                    "fontface": 1,
                    "id": "obj-3",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 131.03448963165283, 348.2758803367615, 157.0, 20.0 ],
                    "text": "== ANALYSIS ENGINE ==",
                    "textcolor": [ 1.0, 1.0, 1.0, 1.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-500",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 9,
                    "outlettype": [ "", "", "", "", "", "", "", "", "" ],
                    "patching_rect": [ 162.06897401809692, 400.00002098083496, 158.92856991291046, 22.0 ],
                    "saved_object_attributes": {
                        "filename": "analyze_reader.js",
                        "parameter_enable": 0
                    },
                    "text": "js analyze_reader.js"
                }
            },
            {
                "box": {
                    "id": "obj-501",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 4,
                    "outlettype": [ "", "", "", "" ],
                    "patching_rect": [ 162.06897401809692, 458.6207137107849, 109.68053948879242, 22.0 ],
                    "saved_object_attributes": {
                        "filename": "slice_writer.js",
                        "parameter_enable": 0
                    },
                    "text": "js slice_writer.js"
                }
            },
            {
                "box": {
                    "fontface": 1,
                    "id": "obj-540",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 131.03448963165283, 613.7931356430054, 143.0, 20.0 ],
                    "text": "== SLICER ENGINE ==",
                    "textcolor": [ 1.0, 1.0, 1.0, 1.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-551",
                    "maxclass": "newobj",
                    "numinlets": 3,
                    "numoutlets": 6,
                    "outlettype": [ "", "", "", "", "", "" ],
                    "patching_rect": [ 162.06897401809692, 668.9655523300171, 102.4, 22.0 ],
                    "saved_object_attributes": {
                        "filename": "slicer.js",
                        "parameter_enable": 0
                    },
                    "text": "js slicer.js"
                }
            },
            {
                "box": {
                    "fontface": 1,
                    "id": "obj-590",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 136.0, 1208.0, 189.34477643966676, 20.0 ],
                    "text": "== PLAYBACK ==",
                    "textcolor": [ 1.0, 1.0, 1.0, 1.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-709",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 168.0, 1474.0, 76.11463540792465, 22.0 ],
                    "text": "next vocals"
                }
            },
            {
                "box": {
                    "id": "obj-710",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "list" ],
                    "patching_rect": [ 274.0, 1370.0, 119.0, 22.0 ],
                    "text": "karma~ ring_0_voc"
                }
            },
            {
                "box": {
                    "id": "obj-711",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 274.0, 1908.0, 80.0, 22.0 ],
                    "text": "*~ 0.7"
                }
            },
            {
                "box": {
                    "id": "obj-739",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 744.0, 1474.0, 68.0, 22.0 ],
                    "text": "next drums"
                }
            },
            {
                "box": {
                    "id": "obj-740",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "list" ],
                    "patching_rect": [ 868.0, 1370.0, 118.0, 22.0 ],
                    "text": "karma~ ring_0_drm"
                }
            },
            {
                "box": {
                    "id": "obj-741",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 920.0, 1908.0, 80.0, 22.0 ],
                    "text": "*~ 0.7"
                }
            },
            {
                "box": {
                    "id": "obj-770",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "list" ],
                    "patching_rect": [ 1434.0, 1370.0, 113.0, 22.0 ],
                    "text": "karma~ ring_0_bss"
                }
            },
            {
                "box": {
                    "id": "obj-771",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1546.0, 1908.0, 80.0, 22.0 ],
                    "text": "*~ 0.7"
                }
            },
            {
                "box": {
                    "id": "obj-799",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 1958.0, 1474.0, 73.0, 22.0 ],
                    "text": "next melody"
                }
            },
            {
                "box": {
                    "id": "obj-800",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "list" ],
                    "patching_rect": [ 2046.0, 1370.0, 114.0, 22.0 ],
                    "text": "karma~ ring_0_mel"
                }
            },
            {
                "box": {
                    "id": "obj-801",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 2106.0, 1908.0, 80.0, 22.0 ],
                    "text": "*~ 0.7"
                }
            },
            {
                "box": {
                    "filename": "fluid.waveform~",
                    "id": "obj-198",
                    "maxclass": "jsui",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 4551.063797235489, 1695.7446687221527, 311.1111259460449, 89.58333760499954 ]
                }
            },
            {
                "box": {
                    "id": "obj-230016",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 4920.212730765343, 3095.7446587085724, 120.0, 22.0 ],
                    "text": "print flucoma_error"
                }
            },
            {
                "box": {
                    "id": "obj-4003",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patcher": {
                        "fileversion": 1,
                        "appversion": {
                            "major": 9,
                            "minor": 1,
                            "revision": 4,
                            "architecture": "x64",
                            "modernui": 1
                        },
                        "classnamespace": "box",
                        "rect": [ 895.0, 455.0, 799.0, 511.0 ],
                        "boxes": [
                            {
                                "box": {
                                    "id": "obj-16",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "", "" ],
                                    "patching_rect": [ 133.0, 178.0, 387.0, 22.0 ],
                                    "text": "fluid.bufselect~ @source stem_drums @destination stem_drums.mono"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-13",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 2,
                                    "outlettype": [ "bang", "" ],
                                    "patching_rect": [ 133.0, 95.0, 45.0, 22.0 ],
                                    "text": "sel 1"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-8",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 10,
                                    "outlettype": [ "float", "list", "float", "float", "float", "float", "float", "", "int", "" ],
                                    "patching_rect": [ 12.0, 57.0, 113.5, 22.0 ],
                                    "text": "info~ stem_drums"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-7",
                                    "maxclass": "message",
                                    "numinlets": 2,
                                    "numoutlets": 1,
                                    "outlettype": [ "" ],
                                    "patching_rect": [ 582.0, 229.0, 82.0, 22.0 ],
                                    "text": "clear, size 1 1"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-4",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "bang", "bang" ],
                                    "patching_rect": [ 338.0, 178.0, 263.0, 22.0 ],
                                    "text": "t b b"
                                }
                            },
                            {
                                "box": {
                                    "color": [ 0.423529411764706, 0.513725490196078, 1.0, 1.0 ],
                                    "id": "obj-14",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "float", "bang" ],
                                    "patching_rect": [ 582.0, 268.0, 149.0, 22.0 ],
                                    "text": "buffer~ stem_drums.mono"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-5",
                                    "maxclass": "message",
                                    "numinlets": 2,
                                    "numoutlets": 1,
                                    "outlettype": [ "" ],
                                    "patching_rect": [ 338.0, 229.0, 201.0, 22.0 ],
                                    "text": "startchan 0, bang, startchan 1, bang"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-3",
                                    "linecount": 3,
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "", "" ],
                                    "patching_rect": [ 338.0, 268.0, 231.0, 49.0 ],
                                    "text": "fluid.bufcompose~ @source stem_drums @destination stem_drums.mono @destgain 0.5 @numchans 1"
                                }
                            },
                            {
                                "box": {
                                    "comment": "",
                                    "id": "obj-2",
                                    "index": 1,
                                    "maxclass": "outlet",
                                    "numinlets": 1,
                                    "numoutlets": 0,
                                    "patching_rect": [ 133.0, 371.0, 30.0, 30.0 ]
                                }
                            },
                            {
                                "box": {
                                    "comment": "",
                                    "id": "obj-1",
                                    "index": 1,
                                    "maxclass": "inlet",
                                    "numinlets": 0,
                                    "numoutlets": 1,
                                    "outlettype": [ "bang" ],
                                    "patching_rect": [ 12.0, 9.0, 30.0, 30.0 ]
                                }
                            }
                        ],
                        "lines": [
                            {
                                "patchline": {
                                    "destination": [ "obj-8", 0 ],
                                    "source": [ "obj-1", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-16", 0 ],
                                    "midpoints": [ 142.5, 120.0, 142.5, 120.0 ],
                                    "source": [ "obj-13", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-4", 0 ],
                                    "midpoints": [ 168.5, 165.0, 347.5, 165.0 ],
                                    "source": [ "obj-13", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-2", 0 ],
                                    "source": [ "obj-16", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-2", 0 ],
                                    "source": [ "obj-3", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-5", 0 ],
                                    "source": [ "obj-4", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-7", 0 ],
                                    "source": [ "obj-4", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-3", 0 ],
                                    "source": [ "obj-5", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-14", 0 ],
                                    "source": [ "obj-7", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-13", 0 ],
                                    "source": [ "obj-8", 8 ]
                                }
                            }
                        ]
                    },
                    "patching_rect": [ 3212.7659344673157, 603.1914850473404, 143.0, 22.0 ],
                    "text": "p stereo_to_mono.drums"
                }
            },
            {
                "box": {
                    "color": [ 0.431372549019608, 0.431372549019608, 0.431372549019608, 1.0 ],
                    "id": "obj-4004",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 3170.212743282318, 264.8936151266098, 149.0, 22.0 ],
                    "saved_attribute_attributes": {
                        "color": {
                            "expression": "themecolor.live_surface_frame_focus"
                        }
                    },
                    "saved_newobj_attribute_attributes": {
                        "color": {
                            "expression": "themecolor.live_surface_frame_focus"
                        }
                    },
                    "text": "buffer~ stem_drums.mono"
                }
            },
            {
                "box": {
                    "color": [ 1.0, 0.0, 0.0, 1.0 ],
                    "id": "obj-4005",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 3358.5106142759323, 368.0851037502289, 209.0, 22.0 ],
                    "text": "buffer~ stem_drums_chroma.features"
                }
            },
            {
                "box": {
                    "id": "obj-4006",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 3193.6169984340668, 2348.9361534118652, 475.0, 22.0 ],
                    "text": "fluid.bufchroma~ @source stem_drums.mono @features stem_drums_chroma.features"
                }
            },
            {
                "box": {
                    "id": "obj-4007",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 3193.6169984340668, 2422.340408205986, 236.0, 22.0 ],
                    "text": "features stem_drums_chroma.features red"
                }
            },
            {
                "box": {
                    "id": "obj-4008",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 3446.8084859848022, 2422.340408205986, 253.0, 22.0 ],
                    "text": "clear, addlayer audiobuffer stem_drums.mono"
                }
            },
            {
                "box": {
                    "id": "obj-4009",
                    "maxclass": "button",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 3193.6169984340668, 2306.3829622268677, 24.0, 24.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-4010",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patcher": {
                        "fileversion": 1,
                        "appversion": {
                            "major": 9,
                            "minor": 1,
                            "revision": 4,
                            "architecture": "x64",
                            "modernui": 1
                        },
                        "classnamespace": "box",
                        "rect": [ 895.0, 455.0, 799.0, 511.0 ],
                        "boxes": [
                            {
                                "box": {
                                    "id": "obj-16",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "", "" ],
                                    "patching_rect": [ 133.0, 178.0, 387.0, 22.0 ],
                                    "text": "fluid.bufselect~ @source stem_bass @destination stem_bass.mono"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-13",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 2,
                                    "outlettype": [ "bang", "" ],
                                    "patching_rect": [ 133.0, 95.0, 45.0, 22.0 ],
                                    "text": "sel 1"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-8",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 10,
                                    "outlettype": [ "float", "list", "float", "float", "float", "float", "float", "", "int", "" ],
                                    "patching_rect": [ 12.0, 57.0, 113.5, 22.0 ],
                                    "text": "info~ stem_bass"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-7",
                                    "maxclass": "message",
                                    "numinlets": 2,
                                    "numoutlets": 1,
                                    "outlettype": [ "" ],
                                    "patching_rect": [ 582.0, 229.0, 82.0, 22.0 ],
                                    "text": "clear, size 1 1"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-4",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "bang", "bang" ],
                                    "patching_rect": [ 338.0, 178.0, 263.0, 22.0 ],
                                    "text": "t b b"
                                }
                            },
                            {
                                "box": {
                                    "color": [ 0.423529411764706, 0.513725490196078, 1.0, 1.0 ],
                                    "id": "obj-14",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "float", "bang" ],
                                    "patching_rect": [ 582.0, 268.0, 149.0, 22.0 ],
                                    "text": "buffer~ stem_bass.mono"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-5",
                                    "maxclass": "message",
                                    "numinlets": 2,
                                    "numoutlets": 1,
                                    "outlettype": [ "" ],
                                    "patching_rect": [ 338.0, 229.0, 201.0, 22.0 ],
                                    "text": "startchan 0, bang, startchan 1, bang"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-3",
                                    "linecount": 3,
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "", "" ],
                                    "patching_rect": [ 338.0, 268.0, 231.0, 49.0 ],
                                    "text": "fluid.bufcompose~ @source stem_bass @destination stem_bass.mono @destgain 0.5 @numchans 1"
                                }
                            },
                            {
                                "box": {
                                    "comment": "",
                                    "id": "obj-2",
                                    "index": 1,
                                    "maxclass": "outlet",
                                    "numinlets": 1,
                                    "numoutlets": 0,
                                    "patching_rect": [ 133.0, 371.0, 30.0, 30.0 ]
                                }
                            },
                            {
                                "box": {
                                    "comment": "",
                                    "id": "obj-1",
                                    "index": 1,
                                    "maxclass": "inlet",
                                    "numinlets": 0,
                                    "numoutlets": 1,
                                    "outlettype": [ "bang" ],
                                    "patching_rect": [ 12.0, 9.0, 30.0, 30.0 ]
                                }
                            }
                        ],
                        "lines": [
                            {
                                "patchline": {
                                    "destination": [ "obj-8", 0 ],
                                    "source": [ "obj-1", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-16", 0 ],
                                    "midpoints": [ 142.5, 120.0, 142.5, 120.0 ],
                                    "source": [ "obj-13", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-4", 0 ],
                                    "midpoints": [ 168.5, 165.0, 347.5, 165.0 ],
                                    "source": [ "obj-13", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-2", 0 ],
                                    "source": [ "obj-16", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-2", 0 ],
                                    "source": [ "obj-3", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-5", 0 ],
                                    "source": [ "obj-4", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-7", 0 ],
                                    "source": [ "obj-4", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-3", 0 ],
                                    "source": [ "obj-5", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-14", 0 ],
                                    "source": [ "obj-7", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-13", 0 ],
                                    "source": [ "obj-8", 8 ]
                                }
                            }
                        ]
                    },
                    "patching_rect": [ 3908.5106103420258, 603.1914850473404, 143.0, 22.0 ],
                    "text": "p stereo_to_mono.bass"
                }
            },
            {
                "box": {
                    "color": [ 0.431372549019608, 0.431372549019608, 0.431372549019608, 1.0 ],
                    "id": "obj-4011",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 3827.6595470905304, 264.8936151266098, 149.0, 22.0 ],
                    "saved_attribute_attributes": {
                        "color": {
                            "expression": "themecolor.live_surface_frame_focus"
                        }
                    },
                    "saved_newobj_attribute_attributes": {
                        "color": {
                            "expression": "themecolor.live_surface_frame_focus"
                        }
                    },
                    "text": "buffer~ stem_bass.mono"
                }
            },
            {
                "box": {
                    "color": [ 1.0, 0.0, 0.0, 1.0 ],
                    "id": "obj-4012",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 4024.468056321144, 368.0851037502289, 201.0, 22.0 ],
                    "text": "buffer~ stem_bass_chroma.features"
                }
            },
            {
                "box": {
                    "id": "obj-4013",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 3877.6595467329025, 2348.9361534118652, 475.0, 22.0 ],
                    "text": "fluid.bufchroma~ @source stem_bass.mono @features stem_bass_chroma.features"
                }
            },
            {
                "box": {
                    "id": "obj-4014",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 3877.6595467329025, 2422.340408205986, 236.0, 22.0 ],
                    "text": "features stem_bass_chroma.features red"
                }
            },
            {
                "box": {
                    "id": "obj-4015",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 4127.659544944763, 2422.340408205986, 253.0, 22.0 ],
                    "text": "clear, addlayer audiobuffer stem_bass.mono"
                }
            },
            {
                "box": {
                    "id": "obj-4016",
                    "maxclass": "button",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 3877.6595467329025, 2306.3829622268677, 24.0, 24.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-4017",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patcher": {
                        "fileversion": 1,
                        "appversion": {
                            "major": 9,
                            "minor": 1,
                            "revision": 4,
                            "architecture": "x64",
                            "modernui": 1
                        },
                        "classnamespace": "box",
                        "rect": [ 895.0, 455.0, 799.0, 511.0 ],
                        "boxes": [
                            {
                                "box": {
                                    "id": "obj-16",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "", "" ],
                                    "patching_rect": [ 133.0, 178.0, 387.0, 22.0 ],
                                    "text": "fluid.bufselect~ @source stem_melo @destination stem_melo.mono"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-13",
                                    "maxclass": "newobj",
                                    "numinlets": 2,
                                    "numoutlets": 2,
                                    "outlettype": [ "bang", "" ],
                                    "patching_rect": [ 133.0, 95.0, 45.0, 22.0 ],
                                    "text": "sel 1"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-8",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 10,
                                    "outlettype": [ "float", "list", "float", "float", "float", "float", "float", "", "int", "" ],
                                    "patching_rect": [ 12.0, 57.0, 113.5, 22.0 ],
                                    "text": "info~ stem_melo"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-7",
                                    "maxclass": "message",
                                    "numinlets": 2,
                                    "numoutlets": 1,
                                    "outlettype": [ "" ],
                                    "patching_rect": [ 582.0, 229.0, 82.0, 22.0 ],
                                    "text": "clear, size 1 1"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-4",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "bang", "bang" ],
                                    "patching_rect": [ 338.0, 178.0, 263.0, 22.0 ],
                                    "text": "t b b"
                                }
                            },
                            {
                                "box": {
                                    "color": [ 0.423529411764706, 0.513725490196078, 1.0, 1.0 ],
                                    "id": "obj-14",
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "float", "bang" ],
                                    "patching_rect": [ 582.0, 268.0, 149.0, 22.0 ],
                                    "text": "buffer~ stem_melo.mono"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-5",
                                    "maxclass": "message",
                                    "numinlets": 2,
                                    "numoutlets": 1,
                                    "outlettype": [ "" ],
                                    "patching_rect": [ 338.0, 229.0, 201.0, 22.0 ],
                                    "text": "startchan 0, bang, startchan 1, bang"
                                }
                            },
                            {
                                "box": {
                                    "id": "obj-3",
                                    "linecount": 3,
                                    "maxclass": "newobj",
                                    "numinlets": 1,
                                    "numoutlets": 2,
                                    "outlettype": [ "", "" ],
                                    "patching_rect": [ 338.0, 268.0, 231.0, 49.0 ],
                                    "text": "fluid.bufcompose~ @source stem_melo @destination stem_melo.mono @destgain 0.5 @numchans 1"
                                }
                            },
                            {
                                "box": {
                                    "comment": "",
                                    "id": "obj-2",
                                    "index": 1,
                                    "maxclass": "outlet",
                                    "numinlets": 1,
                                    "numoutlets": 0,
                                    "patching_rect": [ 133.0, 371.0, 30.0, 30.0 ]
                                }
                            },
                            {
                                "box": {
                                    "comment": "",
                                    "id": "obj-1",
                                    "index": 1,
                                    "maxclass": "inlet",
                                    "numinlets": 0,
                                    "numoutlets": 1,
                                    "outlettype": [ "bang" ],
                                    "patching_rect": [ 12.0, 9.0, 30.0, 30.0 ]
                                }
                            }
                        ],
                        "lines": [
                            {
                                "patchline": {
                                    "destination": [ "obj-8", 0 ],
                                    "source": [ "obj-1", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-16", 0 ],
                                    "midpoints": [ 142.5, 120.0, 142.5, 120.0 ],
                                    "source": [ "obj-13", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-4", 0 ],
                                    "midpoints": [ 168.5, 165.0, 347.5, 165.0 ],
                                    "source": [ "obj-13", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-2", 0 ],
                                    "source": [ "obj-16", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-2", 0 ],
                                    "source": [ "obj-3", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-5", 0 ],
                                    "source": [ "obj-4", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-7", 0 ],
                                    "source": [ "obj-4", 1 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-3", 0 ],
                                    "source": [ "obj-5", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-14", 0 ],
                                    "source": [ "obj-7", 0 ]
                                }
                            },
                            {
                                "patchline": {
                                    "destination": [ "obj-13", 0 ],
                                    "source": [ "obj-8", 8 ]
                                }
                            }
                        ]
                    },
                    "patching_rect": [ 4596.808477759361, 603.1914850473404, 143.0, 22.0 ],
                    "text": "p stereo_to_mono.melo"
                }
            },
            {
                "box": {
                    "color": [ 0.431372549019608, 0.431372549019608, 0.431372549019608, 1.0 ],
                    "id": "obj-4018",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 4546.808478116989, 264.8936151266098, 149.0, 22.0 ],
                    "saved_attribute_attributes": {
                        "color": {
                            "expression": "themecolor.live_surface_frame_focus"
                        }
                    },
                    "saved_newobj_attribute_attributes": {
                        "color": {
                            "expression": "themecolor.live_surface_frame_focus"
                        }
                    },
                    "text": "buffer~ stem_melo.mono"
                }
            },
            {
                "box": {
                    "color": [ 1.0, 0.0, 0.0, 1.0 ],
                    "id": "obj-4019",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 4739.361668229103, 368.0851037502289, 201.0, 22.0 ],
                    "text": "buffer~ stem_melo_chroma.features"
                }
            },
            {
                "box": {
                    "id": "obj-4020",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 4535.106350541115, 2348.9361534118652, 475.0, 22.0 ],
                    "text": "fluid.bufchroma~ @source stem_melo.mono @features stem_melo_chroma.features"
                }
            },
            {
                "box": {
                    "id": "obj-4021",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 4535.106350541115, 2422.340408205986, 236.0, 22.0 ],
                    "text": "features stem_melo_chroma.features red"
                }
            },
            {
                "box": {
                    "id": "obj-4022",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 4785.1063487529755, 2422.340408205986, 253.0, 22.0 ],
                    "text": "clear, addlayer audiobuffer stem_melo.mono"
                }
            },
            {
                "box": {
                    "id": "obj-4023",
                    "maxclass": "button",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "parameter_enable": 0,
                    "patching_rect": [ 4535.106350541115, 2306.3829622268677, 24.0, 24.0 ]
                }
            },
            {
                "box": {
                    "id": "obj-4030",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 5120.547572851181, 195.8903967142105, 209.0, 22.0 ],
                    "saved_object_attributes": {
                        "autostart": 0,
                        "defer": 0,
                        "watch": 0
                    },
                    "text": "node.script ws_server.js @autostart 1",
                    "textfile": {
                        "filename": "ws_server.js",
                        "flags": 0,
                        "embed": 0,
                        "autowatch": 1
                    }
                }
            },
            {
                "box": {
                    "id": "obj-4031",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5336.985913276672, 195.8903967142105, 80.0, 22.0 ],
                    "text": "print ws"
                }
            },
            {
                "box": {
                    "id": "obj-4038",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "patching_rect": [ 5121.917435765266, 157.53423511981964, 67.7852378487587, 22.0 ],
                    "text": "delay 500"
                }
            },
            {
                "box": {
                    "id": "obj-4039",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 5197.259896039963, 157.53423511981964, 64.0, 22.0 ],
                    "text": "script start"
                }
            },
            {
                "box": {
                    "id": "obj-4041",
                    "linecount": 2,
                    "maxclass": "newobj",
                    "numinlets": 25,
                    "numoutlets": 25,
                    "outlettype": [ "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "" ],
                    "patching_rect": [ 5120.547572851181, 235.61642122268677, 758.1395077705383, 35.0 ],
                    "text": "route buildIndex start stop selectSegment setSegmentBars setStayProb setQuantize setFallbackBPM setWeight setMatchProb setDirPref setDirWeight setTrackWeight nextNearest reset info loop unloop unloopAll setGlobalBPM setMaxSlices resetMemory pitchShift followStem"
                }
            },
            {
                "box": {
                    "id": "obj-4042",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 5120.547572851181, 297.26025235652924, 130.0, 22.0 ],
                    "text": "prepend buildIndex"
                }
            },
            {
                "box": {
                    "id": "obj-4043",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 5120.547572851181, 331.50682520866394, 95.0, 22.0 ],
                    "text": "prepend start"
                }
            },
            {
                "box": {
                    "id": "obj-4044",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 5120.547572851181, 368.4931238889694, 88.0, 22.0 ],
                    "text": "prepend stop"
                }
            },
            {
                "box": {
                    "id": "obj-4045",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 5120.547572851181, 409.58901131153107, 151.0, 22.0 ],
                    "text": "prepend selectSegment"
                }
            },
            {
                "box": {
                    "id": "obj-4046",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 5297.259888768196, 297.26025235652924, 158.0, 22.0 ],
                    "text": "prepend setSegmentBars"
                }
            },
            {
                "box": {
                    "id": "obj-4047",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 5297.259888768196, 330.13696229457855, 137.0, 22.0 ],
                    "text": "prepend setStayProb"
                }
            },
            {
                "box": {
                    "id": "obj-4048",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 5297.259888768196, 368.4931238889694, 137.0, 22.0 ],
                    "text": "prepend setQuantize"
                }
            },
            {
                "box": {
                    "id": "obj-4049",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 5297.259888768196, 409.58901131153107, 158.0, 22.0 ],
                    "text": "prepend setFallbackBPM"
                }
            },
            {
                "box": {
                    "id": "obj-4050",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 5480.821519255638, 297.26025235652924, 123.0, 22.0 ],
                    "text": "prepend setWeight"
                }
            },
            {
                "box": {
                    "id": "obj-4051",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 5480.821519255638, 330.13696229457855, 144.0, 22.0 ],
                    "text": "prepend setMatchProb"
                }
            },
            {
                "box": {
                    "id": "obj-4052",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 5664.38314974308, 297.26025235652924, 130.0, 22.0 ],
                    "text": "prepend setDirPref"
                }
            },
            {
                "box": {
                    "id": "obj-4053",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 5480.821519255638, 368.4931238889694, 144.0, 22.0 ],
                    "text": "prepend setDirWeight"
                }
            },
            {
                "box": {
                    "id": "obj-4054",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 5480.821519255638, 409.58901131153107, 158.0, 22.0 ],
                    "text": "prepend setTrackWeight"
                }
            },
            {
                "box": {
                    "id": "obj-4055",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 5664.38314974308, 330.13696229457855, 137.0, 22.0 ],
                    "text": "prepend nextNearest"
                }
            },
            {
                "box": {
                    "id": "obj-4056",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 5664.38314974308, 368.4931238889694, 95.0, 22.0 ],
                    "text": "prepend reset"
                }
            },
            {
                "box": {
                    "id": "obj-4057",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 5664.38314974308, 406.8492854833603, 88.0, 22.0 ],
                    "text": "prepend info"
                }
            },
            {
                "box": {
                    "id": "obj-4058",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 5820.547521948814, 297.26025235652924, 88.0, 22.0 ],
                    "text": "prepend loop"
                }
            },
            {
                "box": {
                    "id": "obj-4059",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 5820.547521948814, 330.13696229457855, 102.0, 22.0 ],
                    "text": "prepend unloop"
                }
            },
            {
                "box": {
                    "id": "obj-4060",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 5820.547521948814, 368.4931238889694, 123.0, 22.0 ],
                    "text": "prepend unloopAll"
                }
            },
            {
                "box": {
                    "id": "obj-4061",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 5983.561208724976, 330.13696229457855, 145.20546889305115, 22.0 ],
                    "text": "prepend setGlobalBPM"
                }
            },
            {
                "box": {
                    "id": "obj-4064",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 2,
                    "outlettype": [ "bang", "" ],
                    "patching_rect": [ 840.0000250339508, 796.6666904091835, 150.0, 22.0 ],
                    "text": "select need_stemDurs"
                }
            },
            {
                "box": {
                    "id": "obj-4065",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 4,
                    "outlettype": [ "bang", "bang", "bang", "bang" ],
                    "patching_rect": [ 840.0000250339508, 826.6666913032532, 80.0, 22.0 ],
                    "text": "t b b b b"
                }
            },
            {
                "box": {
                    "id": "obj-4066",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 5820.547521948814, 406.8492854833603, 140.0, 22.0 ],
                    "text": "prepend setMaxSlices"
                }
            },
            {
                "box": {
                    "id": "obj-5000",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 2030.0, 2660.0, 35.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-5001",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 2030.0, 2708.0, 35.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-5002",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 2030.0, 2750.0, 35.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-5003",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 2264.0, 2656.0, 98.33333098888397, 22.0 ],
                    "text": "fluid.loudness~"
                }
            },
            {
                "box": {
                    "id": "obj-5004",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "patching_rect": [ 2264.0, 2698.0, 65.0, 22.0 ],
                    "text": "metro 100"
                }
            },
            {
                "box": {
                    "id": "obj-5005",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "float" ],
                    "patching_rect": [ 2264.0, 2740.0, 80.0, 22.0 ],
                    "text": "snapshot~"
                }
            },
            {
                "box": {
                    "id": "obj-5006",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "float" ],
                    "patching_rect": [ 2364.0, 2740.0, 80.0, 22.0 ],
                    "text": "snapshot~"
                }
            },
            {
                "box": {
                    "id": "obj-5007",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2264.0, 2778.0, 70.0, 22.0 ],
                    "text": "pak 0. 0."
                }
            },
            {
                "box": {
                    "id": "obj-5008",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2264.0, 2812.0, 95.0, 22.0 ],
                    "text": "prepend lufs"
                }
            },
            {
                "box": {
                    "id": "obj-9902",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 334.48277616500854, 486.20692205429077, 174.0, 22.0 ],
                    "text": "read analysis_library.json"
                }
            },
            {
                "box": {
                    "id": "obj-9903",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 5,
                    "outlettype": [ "dictionary", "", "", "", "" ],
                    "patching_rect": [ 162.06897401809692, 541.3793387413025, 98.0, 22.0 ],
                    "saved_object_attributes": {
                        "legacy": 0,
                        "parameter_enable": 0,
                        "parameter_mappable": 0
                    },
                    "text": "dict analysisLib"
                }
            },
            {
                "box": {
                    "id": "obj-9910",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 965.5172920227051, 144.82759380340576, 90.0, 22.0 ],
                    "text": "wipe memory"
                }
            },
            {
                "box": {
                    "id": "obj-9911",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "bang", "bang" ],
                    "patching_rect": [ 531.0345106124878, 472.41381788253784, 36.0, 22.0 ],
                    "text": "t b b"
                }
            },
            {
                "box": {
                    "id": "obj-9912",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 541.3793387413025, 506.89657831192017, 38.0, 22.0 ],
                    "text": "clear"
                }
            },
            {
                "box": {
                    "id": "obj-9913",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 531.0345106124878, 548.275890827179, 184.0, 22.0 ],
                    "text": "export analysis_library.json"
                }
            },
            {
                "box": {
                    "id": "obj-4067",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 5983.561208724976, 297.26025235652924, 145.20546889305115, 22.0 ],
                    "text": "prepend resetMemory"
                }
            },
            {
                "box": {
                    "id": "obj-9920",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 458.6207137107849, 275.8620834350586, 80.0, 22.0 ],
                    "text": "startStem $1"
                }
            },
            {
                "box": {
                    "id": "obj-9921",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 327.5862240791321, 275.8620834350586, 110.0, 22.0 ],
                    "text": "startAnalysis"
                }
            },
            {
                "box": {
                    "id": "obj-5011",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 2264.0, 2622.0, 95.0, 22.0 ],
                    "text": "route ws_ready"
                }
            },
            {
                "box": {
                    "id": "obj-6001",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 2,
                    "outlettype": [ "bang", "" ],
                    "patching_rect": [ 162.06897401809692, 427.5862293243408, 100.0, 22.0 ],
                    "text": "sel all_done"
                }
            },
            {
                "box": {
                    "id": "obj-6002",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 162.06897401809692, 486.20692205429077, 140.0, 22.0 ],
                    "text": "prepend analysisDone"
                }
            },
            {
                "box": {
                    "id": "obj-9922",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 386.20691680908203, 151.72414588928223, 150.0, 22.0 ],
                    "text": "prepend streamUpdated"
                }
            },
            {
                "box": {
                    "id": "obj-9961",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 18,
                    "outlettype": [ "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "" ],
                    "patching_rect": [ 168.00000500679016, 882.6666929721832, 130.0, 22.0 ],
                    "saved_object_attributes": {
                        "filename": "buffer_manager.js",
                        "parameter_enable": 0
                    },
                    "text": "js buffer_manager.js"
                }
            },
            {
                "box": {
                    "id": "obj-9970",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 2570.2127475738525, 303.1914871931076, 152.0, 22.0 ],
                    "text": "buffer~ src_0_voc"
                }
            },
            {
                "box": {
                    "id": "obj-9971",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 3170.212743282318, 303.1914871931076, 138.0, 22.0 ],
                    "text": "buffer~ src_0_drm"
                }
            },
            {
                "box": {
                    "id": "obj-9972",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 3827.6595470905304, 303.1914871931076, 138.0, 22.0 ],
                    "text": "buffer~ src_0_bss"
                }
            },
            {
                "box": {
                    "id": "obj-9973",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 4546.808478116989, 303.1914871931076, 138.0, 22.0 ],
                    "text": "buffer~ src_0_mel"
                }
            },
            {
                "box": {
                    "id": "obj-9974",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 10,
                    "outlettype": [ "float", "list", "float", "float", "float", "float", "float", "", "int", "" ],
                    "patching_rect": [ 2570.2127475738525, 491.4893581867218, 138.0, 22.0 ],
                    "text": "info~ src_0_voc"
                }
            },
            {
                "box": {
                    "id": "obj-9975",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 10,
                    "outlettype": [ "float", "list", "float", "float", "float", "float", "float", "", "int", "" ],
                    "patching_rect": [ 3165.9574241638184, 491.4893581867218, 114.0, 22.0 ],
                    "text": "info~ src_0_drm"
                }
            },
            {
                "box": {
                    "id": "obj-9976",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 10,
                    "outlettype": [ "float", "list", "float", "float", "float", "float", "float", "", "int", "" ],
                    "patching_rect": [ 3824.4680577516556, 491.4893581867218, 124.0, 22.0 ],
                    "text": "info~ src_0_bss"
                }
            },
            {
                "box": {
                    "id": "obj-9977",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 10,
                    "outlettype": [ "float", "list", "float", "float", "float", "float", "float", "", "int", "" ],
                    "patching_rect": [ 4546.808478116989, 491.4893581867218, 124.0, 22.0 ],
                    "text": "info~ src_0_mel"
                }
            },
            {
                "box": {
                    "id": "obj-9978",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 2570.2127475738525, 329.7872316837311, 150.0, 22.0 ],
                    "text": "buffer~ src_1_voc"
                }
            },
            {
                "box": {
                    "id": "obj-9979",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 3165.9574241638184, 326.59574234485626, 150.0, 22.0 ],
                    "text": "buffer~ src_1_drm"
                }
            },
            {
                "box": {
                    "id": "obj-9980",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 3827.6595470905304, 326.59574234485626, 150.0, 22.0 ],
                    "text": "buffer~ src_1_bss"
                }
            },
            {
                "box": {
                    "id": "obj-9981",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 4546.808478116989, 326.59574234485626, 150.0, 22.0 ],
                    "text": "buffer~ src_1_mel"
                }
            },
            {
                "box": {
                    "id": "obj-9982",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 20,
                    "outlettype": [ "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "" ],
                    "patching_rect": [ 164.0, 1097.0, 130.0, 22.0 ],
                    "saved_object_attributes": {
                        "filename": "slot_router.js",
                        "parameter_enable": 0
                    },
                    "text": "js slot_router.js"
                }
            },
            {
                "box": {
                    "id": "obj-9983",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 2570.2127475738525, 368.0851037502289, 150.0, 22.0 ],
                    "text": "buffer~ ring_0_voc"
                }
            },
            {
                "box": {
                    "id": "obj-9984",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 2570.2127475738525, 391.48935890197754, 150.0, 22.0 ],
                    "text": "buffer~ ring_1_voc"
                }
            },
            {
                "box": {
                    "id": "obj-9985",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 3165.9574241638184, 368.0851037502289, 150.0, 22.0 ],
                    "text": "buffer~ ring_0_drm"
                }
            },
            {
                "box": {
                    "id": "obj-9986",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 3165.9574241638184, 391.48935890197754, 150.0, 22.0 ],
                    "text": "buffer~ ring_1_drm"
                }
            },
            {
                "box": {
                    "id": "obj-9987",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 3827.6595470905304, 368.0851037502289, 150.0, 22.0 ],
                    "text": "buffer~ ring_0_bss"
                }
            },
            {
                "box": {
                    "id": "obj-9988",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 3827.6595470905304, 395.7446780204773, 150.0, 22.0 ],
                    "text": "buffer~ ring_1_bss"
                }
            },
            {
                "box": {
                    "id": "obj-9989",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 4546.808478116989, 368.0851037502289, 150.0, 22.0 ],
                    "text": "buffer~ ring_0_mel"
                }
            },
            {
                "box": {
                    "id": "obj-9990",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 4546.808478116989, 395.7446780204773, 150.0, 22.0 ],
                    "text": "buffer~ ring_1_mel"
                }
            },
            {
                "box": {
                    "id": "obj-9992",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 2781.9148737192154, 568.0851023197174, 130.0, 22.0 ],
                    "text": "fluid.bufcompose~"
                }
            },
            {
                "box": {
                    "id": "obj-9993",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 3393.6169970035553, 568.0851023197174, 130.0, 22.0 ],
                    "text": "fluid.bufcompose~"
                }
            },
            {
                "box": {
                    "id": "obj-9994",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 4085.1063537597656, 572.3404214382172, 130.0, 22.0 ],
                    "text": "fluid.bufcompose~"
                }
            },
            {
                "box": {
                    "id": "obj-9995",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 4774.468050956726, 572.3404214382172, 130.0, 22.0 ],
                    "text": "fluid.bufcompose~"
                }
            },
            {
                "box": {
                    "id": "obj-9997",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 168.00000500679016, 802.6666905879974, 140.0, 22.0 ],
                    "text": "prepend src_done voc 0"
                }
            },
            {
                "box": {
                    "id": "obj-9998",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 168.00000500679016, 826.6666913032532, 140.0, 22.0 ],
                    "text": "prepend src_done voc 1"
                }
            },
            {
                "box": {
                    "id": "obj-9999",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 340.0000101327896, 802.6666905879974, 140.0, 22.0 ],
                    "text": "prepend src_done drm 0"
                }
            },
            {
                "box": {
                    "id": "obj-10000",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 340.0000101327896, 826.6666913032532, 140.0, 22.0 ],
                    "text": "prepend src_done drm 1"
                }
            },
            {
                "box": {
                    "id": "obj-10001",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 500.0000149011612, 802.6666905879974, 140.0, 22.0 ],
                    "text": "prepend src_done bss 0"
                }
            },
            {
                "box": {
                    "id": "obj-10002",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 500.0000149011612, 826.6666913032532, 140.0, 22.0 ],
                    "text": "prepend src_done bss 1"
                }
            },
            {
                "box": {
                    "id": "obj-10003",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 668.0000199079514, 802.6666905879974, 140.0, 22.0 ],
                    "text": "prepend src_done mel 0"
                }
            },
            {
                "box": {
                    "id": "obj-10004",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 668.0000199079514, 826.6666913032532, 140.0, 22.0 ],
                    "text": "prepend src_done mel 1"
                }
            },
            {
                "box": {
                    "id": "obj-10005",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2781.9148737192154, 603.1914850473404, 131.0, 22.0 ],
                    "text": "prepend ring_done voc"
                }
            },
            {
                "box": {
                    "id": "obj-10006",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 3393.6169970035553, 603.1914850473404, 133.0, 22.0 ],
                    "text": "prepend ring_done drm"
                }
            },
            {
                "box": {
                    "id": "obj-10007",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 4085.1063537597656, 603.1914850473404, 131.0, 22.0 ],
                    "text": "prepend ring_done bss"
                }
            },
            {
                "box": {
                    "id": "obj-10008",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 4774.468050956726, 603.1914850473404, 132.0, 22.0 ],
                    "text": "prepend ring_done mel"
                }
            },
            {
                "box": {
                    "id": "obj-4068",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 5983.561208724976, 368.4931238889694, 145.20546889305115, 22.0 ],
                    "text": "prepend pitchShift"
                }
            },
            {
                "box": {
                    "id": "obj-4069",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 5983.561208724976, 406.8492854833603, 145.20546889305115, 22.0 ],
                    "text": "prepend followStem"
                }
            },
            {
                "box": {
                    "id": "obj-5100",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 320.0, 1408.0, 200.0, 22.0 ],
                    "text": "pfft~ ebys-pitch.maxpat 1024 4"
                }
            },
            {
                "box": {
                    "id": "obj-5101",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 920.0, 1408.0, 200.0, 22.0 ],
                    "text": "pfft~ ebys-pitch.maxpat 1024 4"
                }
            },
            {
                "box": {
                    "id": "obj-5102",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1488.0, 1408.0, 200.0, 22.0 ],
                    "text": "pfft~ ebys-pitch.maxpat 1024 4"
                }
            },
            {
                "box": {
                    "id": "obj-5103",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 2106.0, 1408.0, 200.0, 22.0 ],
                    "text": "pfft~ ebys-pitch.maxpat 1024 4"
                }
            },
            {
                "box": {
                    "id": "obj-10009",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 2570.2127475738525, 437.2340394258499, 150.0, 22.0 ],
                    "text": "buffer~ snap_voc"
                }
            },
            {
                "box": {
                    "id": "obj-10010",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 3165.9574241638184, 445.7446776628494, 150.0, 22.0 ],
                    "text": "buffer~ snap_drm"
                }
            },
            {
                "box": {
                    "id": "obj-10011",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 3824.4680577516556, 445.7446776628494, 150.0, 22.0 ],
                    "text": "buffer~ snap_bss"
                }
            },
            {
                "box": {
                    "id": "obj-10012",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "float", "bang" ],
                    "patching_rect": [ 4546.808478116989, 445.7446776628494, 150.0, 22.0 ],
                    "text": "buffer~ snap_mel"
                }
            },
            {
                "box": {
                    "id": "obj-10013",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 332.00000989437103, 882.6666929721832, 130.0, 22.0 ],
                    "text": "fluid.bufcompose~"
                }
            },
            {
                "box": {
                    "id": "obj-10014",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 332.00000989437103, 912.6666938662529, 130.0, 22.0 ],
                    "text": "fluid.bufcompose~"
                }
            },
            {
                "box": {
                    "id": "obj-10015",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 474.0000141263008, 882.6666929721832, 130.0, 22.0 ],
                    "text": "fluid.bufcompose~"
                }
            },
            {
                "box": {
                    "id": "obj-10016",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 474.0000141263008, 912.6666938662529, 130.0, 22.0 ],
                    "text": "fluid.bufcompose~"
                }
            },
            {
                "box": {
                    "id": "obj-10017",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 332.00000989437103, 946.6666948795319, 137.0, 22.0 ],
                    "text": "prepend bake_done voc"
                }
            },
            {
                "box": {
                    "id": "obj-10018",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 332.00000989437103, 976.6666957736015, 139.0, 22.0 ],
                    "text": "prepend bake_done drm"
                }
            },
            {
                "box": {
                    "id": "obj-10019",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 474.0000141263008, 946.6666948795319, 137.0, 22.0 ],
                    "text": "prepend bake_done bss"
                }
            },
            {
                "box": {
                    "id": "obj-10020",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 474.0000141263008, 976.6666957736015, 138.0, 22.0 ],
                    "text": "prepend bake_done mel"
                }
            },
            {
                "box": {
                    "id": "obj-437",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "patching_rect": [ 5120.547572851181, 124.65752518177032, 58.0, 22.0 ],
                    "text": "loadbang"
                }
            },
            {
                "box": {
                    "id": "obj-9930",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 279.3103594779968, 541.3793387413025, 100.0, 22.0 ],
                    "text": "loadRegistry"
                }
            },
            {
                "box": {
                    "id": "obj-7005",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "float" ],
                    "patching_rect": [ 2106.0, 2698.0, 110.0, 22.0 ],
                    "text": "peakamp~ 4096"
                }
            },
            {
                "box": {
                    "id": "obj-7012",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2106.0, 2740.0, 140.0, 22.0 ],
                    "text": "prepend meter master"
                }
            },
            {
                "box": {
                    "id": "obj-7013",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2106.0, 2812.0, 45.0, 22.0 ],
                    "text": "gate 1"
                }
            },
            {
                "box": {
                    "id": "obj-7014",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 2,
                    "outlettype": [ "bang", "" ],
                    "patching_rect": [ 2106.0, 2660.0, 100.0, 22.0 ],
                    "text": "sel ws_ready"
                }
            },
            {
                "box": {
                    "id": "obj-7015",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2106.0, 2778.0, 32.0, 22.0 ],
                    "text": "1"
                }
            },
            {
                "box": {
                    "id": "obj-20008",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 188.0, 2130.0, 94.0, 22.0 ],
                    "text": "delay~ 512 7"
                }
            },
            {
                "box": {
                    "id": "obj-20009",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 284.0, 2182.0, 60.0, 22.0 ],
                    "text": "*~ 0"
                }
            },
            {
                "box": {
                    "id": "obj-20010",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 326.0, 2130.0, 144.0, 22.0 ],
                    "text": "receive width_vocals"
                }
            },
            {
                "box": {
                    "id": "obj-20011",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 436.0, 2182.0, 60.0, 22.0 ],
                    "text": "*~ -1"
                }
            },
            {
                "box": {
                    "id": "obj-20012",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 244.0, 2254.0, 60.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-20013",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 396.0, 2254.0, 60.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-20014",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 258.0, 2426.0, 60.0, 22.0 ],
                    "text": "*~ 0.5"
                }
            },
            {
                "box": {
                    "id": "obj-20015",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 402.0, 2426.0, 60.0, 22.0 ],
                    "text": "*~ 0.5"
                }
            },
            {
                "box": {
                    "id": "obj-20018",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 782.0, 2132.0, 94.0, 22.0 ],
                    "text": "delay~ 512 7"
                }
            },
            {
                "box": {
                    "id": "obj-20019",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 878.0, 2182.0, 60.0, 22.0 ],
                    "text": "*~ 0"
                }
            },
            {
                "box": {
                    "id": "obj-20020",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 916.0, 2132.0, 144.0, 22.0 ],
                    "text": "receive width_drums"
                }
            },
            {
                "box": {
                    "id": "obj-20021",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1036.0, 2182.0, 60.0, 22.0 ],
                    "text": "*~ -1"
                }
            },
            {
                "box": {
                    "id": "obj-20022",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 836.0, 2254.0, 60.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-20023",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 996.0, 2254.0, 60.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-20024",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 836.0, 2426.0, 60.0, 22.0 ],
                    "text": "*~ 0.5"
                }
            },
            {
                "box": {
                    "id": "obj-20025",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 996.0, 2426.0, 60.0, 22.0 ],
                    "text": "*~ 0.5"
                }
            },
            {
                "box": {
                    "id": "obj-20028",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1396.0, 2130.0, 94.0, 22.0 ],
                    "text": "delay~ 512 7"
                }
            },
            {
                "box": {
                    "id": "obj-20029",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1488.0, 2174.0, 60.0, 22.0 ],
                    "text": "*~ 0"
                }
            },
            {
                "box": {
                    "id": "obj-20030",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 1534.0, 2130.0, 130.0, 22.0 ],
                    "text": "receive width_bass"
                }
            },
            {
                "box": {
                    "id": "obj-20031",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1664.0, 2174.0, 60.0, 22.0 ],
                    "text": "*~ -1"
                }
            },
            {
                "box": {
                    "id": "obj-20032",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1454.0, 2254.0, 60.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-20033",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1622.0, 2254.0, 60.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-20034",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1454.0, 2426.0, 60.0, 22.0 ],
                    "text": "*~ 0.5"
                }
            },
            {
                "box": {
                    "id": "obj-20035",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1622.0, 2426.0, 60.0, 22.0 ],
                    "text": "*~ 0.5"
                }
            },
            {
                "box": {
                    "id": "obj-20038",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1946.0, 2130.0, 94.0, 22.0 ],
                    "text": "delay~ 512 7"
                }
            },
            {
                "box": {
                    "id": "obj-20039",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 2046.0, 2174.0, 60.0, 22.0 ],
                    "text": "*~ 0"
                }
            },
            {
                "box": {
                    "id": "obj-20040",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2088.0, 2130.0, 137.0, 22.0 ],
                    "text": "receive width_melody"
                }
            },
            {
                "box": {
                    "id": "obj-20041",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 2220.0, 2174.0, 60.0, 22.0 ],
                    "text": "*~ -1"
                }
            },
            {
                "box": {
                    "id": "obj-20042",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 2006.0, 2254.0, 60.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-20043",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 2178.0, 2254.0, 60.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-20044",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 2006.0, 2426.0, 60.0, 22.0 ],
                    "text": "*~ 0.5"
                }
            },
            {
                "box": {
                    "id": "obj-20045",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 2178.0, 2426.0, 60.0, 22.0 ],
                    "text": "*~ 0.5"
                }
            },
            {
                "box": {
                    "id": "obj-20100",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 5121.211669445038, 940.9090079069138, 140.0, 22.0 ],
                    "saved_object_attributes": {
                        "filename": "ms_router.js",
                        "parameter_enable": 0
                    },
                    "text": "js spatialization_router.js"
                }
            },
            {
                "box": {
                    "id": "obj-20101",
                    "linecount": 4,
                    "maxclass": "newobj",
                    "numinlets": 50,
                    "numoutlets": 50,
                    "outlettype": [ "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "" ],
                    "patching_rect": [ 5121.211669445038, 984.8483979701996, 968.1817327737808, 62.0 ],
                    "text": "route width_vocals panL_vocals panR_vocals width_melody panL_melody panR_melody width_bass panL_bass panR_bass width_drums panL_drums panR_drums master_gain fxsend_vocals fxsend_drums fxsend_bass fxsend_melody fxreturn_vocals fxreturn_drums fxreturn_bass fxreturn_melody masterPanLeft masterPanRight panFL_vocals panFR_vocals panRL_vocals panRR_vocals panFL_drums panFR_drums panRL_drums panRR_drums panFL_bass panFR_bass panRL_bass panRR_bass panFL_melody panFR_melody panRL_melody panRR_melody masterJoyX masterJoyY joyX_vocals joyY_vocals joyX_drums joyY_drums joyX_bass joyY_bass joyX_melody joyY_melody"
                }
            },
            {
                "box": {
                    "id": "obj-20102",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5121.211669445038, 1069.696875333786, 128.29653757810593, 22.0 ],
                    "text": "send width_vocals"
                }
            },
            {
                "box": {
                    "id": "obj-20105",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5257.303790688515, 1097.7528966665268, 129.32329678535461, 22.0 ],
                    "text": "send width_melody"
                }
            },
            {
                "box": {
                    "id": "obj-20108",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5257.303790688515, 1069.6630067825317, 129.74801516532898, 22.0 ],
                    "text": "send width_bass"
                }
            },
            {
                "box": {
                    "id": "obj-20111",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5121.348723649979, 1097.212022304535, 126.4172240793705, 22.0 ],
                    "text": "send width_drums"
                }
            },
            {
                "box": {
                    "id": "obj-21032",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 0,
                    "patching_rect": [ 1144.0, 3402.0, 99.0, 22.0 ],
                    "text": "dac~ 1 2"
                }
            },
            {
                "box": {
                    "id": "obj-21070",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1144.0, 3206.0, 60.0, 22.0 ],
                    "text": "*~ 1"
                }
            },
            {
                "box": {
                    "id": "obj-21071",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1220.0, 3206.0, 60.0, 22.0 ],
                    "text": "*~ 1"
                }
            },
            {
                "box": {
                    "id": "obj-22000",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 5120.547572851181, 510.0, 140.0, 22.0 ],
                    "saved_object_attributes": {
                        "filename": "eq_router.js",
                        "parameter_enable": 0
                    },
                    "text": "js eq_router.js"
                }
            },
            {
                "box": {
                    "id": "obj-22001",
                    "linecount": 3,
                    "maxclass": "newobj",
                    "numinlets": 25,
                    "numoutlets": 25,
                    "outlettype": [ "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "" ],
                    "patching_rect": [ 5121.211669445038, 594.0, 798.484778046608, 49.0 ],
                    "text": "route trim_vocals trim_drums trim_bass trim_melody eq_low_coef_vocals eq_low_coef_drums eq_low_coef_bass eq_low_coef_melody eq_mid_coef_vocals eq_mid_coef_drums eq_mid_coef_bass eq_mid_coef_melody eq_high_coef_vocals eq_high_coef_drums eq_high_coef_bass eq_high_coef_melody gain_vocals gain_drums gain_bass gain_melody fader_vocals fader_drums fader_bass fader_melody"
                }
            },
            {
                "box": {
                    "id": "obj-22002",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5873.577809453011, 716.6666034460068, 134.0, 22.0 ],
                    "text": "send trim_vocals"
                }
            },
            {
                "box": {
                    "id": "obj-22003",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5299.33543586731, 743.9393283128738, 150.0, 22.0 ],
                    "text": "send trim_drums"
                }
            },
            {
                "box": {
                    "id": "obj-22004",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5482.668753027916, 743.9393283128738, 141.9998333454132, 22.0 ],
                    "text": "send trim_bass"
                }
            },
            {
                "box": {
                    "id": "obj-22005",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5682.668735384941, 743.9393283128738, 158.0, 22.0 ],
                    "text": "send trim_melody"
                }
            },
            {
                "box": {
                    "id": "obj-22006",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5120.547572851181, 831.8181084394455, 151.0, 22.0 ],
                    "text": "send eq_low_coef_vocals"
                }
            },
            {
                "box": {
                    "id": "obj-22007",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5299.33543586731, 831.8181084394455, 150.0, 22.0 ],
                    "text": "send eq_low_coef_drums"
                }
            },
            {
                "box": {
                    "id": "obj-22008",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5482.668753027916, 831.8181084394455, 141.66667088866234, 22.0 ],
                    "text": "send eq_low_coef_bass"
                }
            },
            {
                "box": {
                    "id": "obj-22009",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5685.699038147926, 831.8181084394455, 157.33333802223206, 22.0 ],
                    "text": "send eq_low_coef_melody"
                }
            },
            {
                "box": {
                    "id": "obj-22010",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5120.547572851181, 803.0302321910858, 151.0, 22.0 ],
                    "text": "send eq_mid_coef_vocals"
                }
            },
            {
                "box": {
                    "id": "obj-22011",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5299.33543586731, 803.0302321910858, 150.0, 22.0 ],
                    "text": "send eq_mid_coef_drums"
                }
            },
            {
                "box": {
                    "id": "obj-22012",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5482.668753027916, 803.0302321910858, 141.66667088866234, 22.0 ],
                    "text": "send eq_mid_coef_bass"
                }
            },
            {
                "box": {
                    "id": "obj-22013",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5685.699038147926, 803.0302321910858, 158.33333805203438, 22.0 ],
                    "text": "send eq_mid_coef_melody"
                }
            },
            {
                "box": {
                    "id": "obj-22014",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5120.547572851181, 777.2726587057114, 151.0, 22.0 ],
                    "text": "send eq_high_coef_vocals"
                }
            },
            {
                "box": {
                    "id": "obj-22015",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5299.33543586731, 774.2423559427261, 150.0, 22.0 ],
                    "text": "send eq_high_coef_drums"
                }
            },
            {
                "box": {
                    "id": "obj-22016",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5482.668753027916, 774.2423559427261, 142.0, 22.0 ],
                    "text": "send eq_high_coef_bass"
                }
            },
            {
                "box": {
                    "id": "obj-22017",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5685.699038147926, 774.2423559427261, 157.33333802223206, 22.0 ],
                    "text": "send eq_high_coef_melody"
                }
            },
            {
                "box": {
                    "id": "obj-22018",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 320.0, 1474.0, 50.0, 22.0 ],
                    "text": "*~"
                }
            },
            {
                "box": {
                    "id": "obj-22019",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 396.0, 1474.0, 140.0, 22.0 ],
                    "text": "receive trim_vocals"
                }
            },
            {
                "box": {
                    "id": "obj-22020",
                    "maxclass": "newobj",
                    "numinlets": 6,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 274.0, 1664.0, 80.0, 22.0 ],
                    "text": "biquad~"
                }
            },
            {
                "box": {
                    "id": "obj-22021",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 402.0, 1564.0, 180.0, 22.0 ],
                    "text": "receive eq_low_coef_vocals"
                }
            },
            {
                "box": {
                    "id": "obj-22022",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 5,
                    "outlettype": [ "float", "float", "float", "float", "float" ],
                    "patching_rect": [ 402.0, 1602.0, 180.0, 22.0 ],
                    "text": "unpack 0. 0. 0. 0. 0."
                }
            },
            {
                "box": {
                    "id": "obj-22023",
                    "maxclass": "newobj",
                    "numinlets": 6,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 274.0, 1760.0, 80.0, 22.0 ],
                    "text": "biquad~"
                }
            },
            {
                "box": {
                    "id": "obj-22024",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 402.0, 1664.0, 180.0, 22.0 ],
                    "text": "receive eq_mid_coef_vocals"
                }
            },
            {
                "box": {
                    "id": "obj-22025",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 5,
                    "outlettype": [ "float", "float", "float", "float", "float" ],
                    "patching_rect": [ 402.0, 1706.0, 180.0, 22.0 ],
                    "text": "unpack 0. 0. 0. 0. 0."
                }
            },
            {
                "box": {
                    "id": "obj-22026",
                    "maxclass": "newobj",
                    "numinlets": 6,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 274.0, 1850.0, 80.0, 22.0 ],
                    "text": "biquad~"
                }
            },
            {
                "box": {
                    "id": "obj-22027",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 402.0, 1760.0, 180.0, 22.0 ],
                    "text": "receive eq_high_coef_vocals"
                }
            },
            {
                "box": {
                    "id": "obj-22028",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 5,
                    "outlettype": [ "float", "float", "float", "float", "float" ],
                    "patching_rect": [ 402.0, 1792.0, 180.0, 22.0 ],
                    "text": "unpack 0. 0. 0. 0. 0."
                }
            },
            {
                "box": {
                    "id": "obj-22029",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 920.0, 1474.0, 50.0, 22.0 ],
                    "text": "*~"
                }
            },
            {
                "box": {
                    "id": "obj-22030",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 1006.0, 1474.0, 140.0, 22.0 ],
                    "text": "receive trim_drums"
                }
            },
            {
                "box": {
                    "id": "obj-22031",
                    "maxclass": "newobj",
                    "numinlets": 6,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 920.0, 1664.0, 80.0, 22.0 ],
                    "text": "biquad~"
                }
            },
            {
                "box": {
                    "id": "obj-22032",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 1054.0, 1564.0, 180.0, 22.0 ],
                    "text": "receive eq_low_coef_drums"
                }
            },
            {
                "box": {
                    "id": "obj-22033",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 5,
                    "outlettype": [ "float", "float", "float", "float", "float" ],
                    "patching_rect": [ 1054.0, 1602.0, 180.0, 22.0 ],
                    "text": "unpack 0. 0. 0. 0. 0."
                }
            },
            {
                "box": {
                    "id": "obj-22034",
                    "maxclass": "newobj",
                    "numinlets": 6,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 920.0, 1760.0, 80.0, 22.0 ],
                    "text": "biquad~"
                }
            },
            {
                "box": {
                    "id": "obj-22035",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 1054.0, 1664.0, 180.0, 22.0 ],
                    "text": "receive eq_mid_coef_drums"
                }
            },
            {
                "box": {
                    "id": "obj-22036",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 5,
                    "outlettype": [ "float", "float", "float", "float", "float" ],
                    "patching_rect": [ 1054.0, 1706.0, 180.0, 22.0 ],
                    "text": "unpack 0. 0. 0. 0. 0."
                }
            },
            {
                "box": {
                    "id": "obj-22037",
                    "maxclass": "newobj",
                    "numinlets": 6,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 920.0, 1854.0, 80.0, 22.0 ],
                    "text": "biquad~"
                }
            },
            {
                "box": {
                    "id": "obj-22038",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 1054.0, 1760.0, 180.0, 22.0 ],
                    "text": "receive eq_high_coef_drums"
                }
            },
            {
                "box": {
                    "id": "obj-22039",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 5,
                    "outlettype": [ "float", "float", "float", "float", "float" ],
                    "patching_rect": [ 1054.0, 1792.0, 180.0, 22.0 ],
                    "text": "unpack 0. 0. 0. 0. 0."
                }
            },
            {
                "box": {
                    "id": "obj-22040",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1488.0, 1474.0, 50.0, 22.0 ],
                    "text": "*~"
                }
            },
            {
                "box": {
                    "id": "obj-22041",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 1574.0, 1474.0, 140.0, 22.0 ],
                    "text": "receive trim_bass"
                }
            },
            {
                "box": {
                    "id": "obj-22042",
                    "maxclass": "newobj",
                    "numinlets": 6,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1554.0, 1664.0, 80.0, 22.0 ],
                    "text": "biquad~"
                }
            },
            {
                "box": {
                    "id": "obj-22043",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 1658.0, 1564.0, 180.0, 22.0 ],
                    "text": "receive eq_low_coef_bass"
                }
            },
            {
                "box": {
                    "id": "obj-22044",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 5,
                    "outlettype": [ "float", "float", "float", "float", "float" ],
                    "patching_rect": [ 1658.0, 1594.0, 180.0, 22.0 ],
                    "text": "unpack 0. 0. 0. 0. 0."
                }
            },
            {
                "box": {
                    "id": "obj-22045",
                    "maxclass": "newobj",
                    "numinlets": 6,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1554.0, 1754.0, 80.0, 22.0 ],
                    "text": "biquad~"
                }
            },
            {
                "box": {
                    "id": "obj-22046",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 1658.0, 1664.0, 180.0, 22.0 ],
                    "text": "receive eq_mid_coef_bass"
                }
            },
            {
                "box": {
                    "id": "obj-22047",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 5,
                    "outlettype": [ "float", "float", "float", "float", "float" ],
                    "patching_rect": [ 1658.0, 1706.0, 180.0, 22.0 ],
                    "text": "unpack 0. 0. 0. 0. 0."
                }
            },
            {
                "box": {
                    "id": "obj-22048",
                    "maxclass": "newobj",
                    "numinlets": 6,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1546.0, 1846.0, 80.0, 22.0 ],
                    "text": "biquad~"
                }
            },
            {
                "box": {
                    "id": "obj-22049",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 1658.0, 1754.0, 180.0, 22.0 ],
                    "text": "receive eq_high_coef_bass"
                }
            },
            {
                "box": {
                    "id": "obj-22050",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 5,
                    "outlettype": [ "float", "float", "float", "float", "float" ],
                    "patching_rect": [ 1658.0, 1792.0, 180.0, 22.0 ],
                    "text": "unpack 0. 0. 0. 0. 0."
                }
            },
            {
                "box": {
                    "id": "obj-22051",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 2106.0, 1474.0, 50.0, 22.0 ],
                    "text": "*~"
                }
            },
            {
                "box": {
                    "id": "obj-22052",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2226.0, 1474.0, 140.0, 22.0 ],
                    "text": "receive trim_melody"
                }
            },
            {
                "box": {
                    "id": "obj-22053",
                    "maxclass": "newobj",
                    "numinlets": 6,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 2106.0, 1664.0, 80.0, 22.0 ],
                    "text": "biquad~"
                }
            },
            {
                "box": {
                    "id": "obj-22054",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2244.0, 1564.0, 180.0, 22.0 ],
                    "text": "receive eq_low_coef_melody"
                }
            },
            {
                "box": {
                    "id": "obj-22055",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 5,
                    "outlettype": [ "float", "float", "float", "float", "float" ],
                    "patching_rect": [ 2244.0, 1602.0, 180.0, 22.0 ],
                    "text": "unpack 0. 0. 0. 0. 0."
                }
            },
            {
                "box": {
                    "id": "obj-22056",
                    "maxclass": "newobj",
                    "numinlets": 6,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 2106.0, 1754.0, 80.0, 22.0 ],
                    "text": "biquad~"
                }
            },
            {
                "box": {
                    "id": "obj-22057",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2244.0, 1664.0, 180.0, 22.0 ],
                    "text": "receive eq_mid_coef_melody"
                }
            },
            {
                "box": {
                    "id": "obj-22058",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 5,
                    "outlettype": [ "float", "float", "float", "float", "float" ],
                    "patching_rect": [ 2244.0, 1706.0, 180.0, 22.0 ],
                    "text": "unpack 0. 0. 0. 0. 0."
                }
            },
            {
                "box": {
                    "id": "obj-22059",
                    "maxclass": "newobj",
                    "numinlets": 6,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 2106.0, 1846.0, 80.0, 22.0 ],
                    "text": "biquad~"
                }
            },
            {
                "box": {
                    "id": "obj-22060",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2244.0, 1754.0, 180.0, 22.0 ],
                    "text": "receive eq_high_coef_melody"
                }
            },
            {
                "box": {
                    "id": "obj-22061",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 5,
                    "outlettype": [ "float", "float", "float", "float", "float" ],
                    "patching_rect": [ 2244.0, 1792.0, 180.0, 22.0 ],
                    "text": "unpack 0. 0. 0. 0. 0."
                }
            },
            {
                "box": {
                    "id": "obj-22062",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "bang" ],
                    "patching_rect": [ 5120.547572851181, 552.0, 70.0, 22.0 ],
                    "text": "loadbang"
                }
            },
            {
                "box": {
                    "id": "obj-22063",
                    "maxclass": "message",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 5200.547572851181, 552.0, 60.0, 22.0 ],
                    "text": "resend"
                }
            },
            {
                "box": {
                    "id": "obj-22064",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 998.0, 3250.0, 96.85039883852005, 22.0 ],
                    "text": "sfrecord~ 2"
                }
            },
            {
                "box": {
                    "id": "obj-22065",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 998.0, 3206.0, 119.0, 22.0 ],
                    "text": "receive record_cmd"
                }
            },
            {
                "box": {
                    "id": "obj-23000",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 382.0, 1946.0, 180.0, 22.0 ],
                    "text": "receive gain_vocals"
                }
            },
            {
                "box": {
                    "id": "obj-23001",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 274.0, 1946.0, 52.0, 22.0 ],
                    "text": "*~ 1"
                }
            },
            {
                "box": {
                    "id": "obj-23002",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 1026.0, 1946.0, 180.0, 22.0 ],
                    "text": "receive gain_drums"
                }
            },
            {
                "box": {
                    "id": "obj-23003",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 920.0, 1946.0, 52.0, 22.0 ],
                    "text": "*~ 1"
                }
            },
            {
                "box": {
                    "id": "obj-23004",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 1660.0, 1946.0, 180.0, 22.0 ],
                    "text": "receive gain_bass"
                }
            },
            {
                "box": {
                    "id": "obj-23005",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1546.0, 1946.0, 52.0, 22.0 ],
                    "text": "*~ 1"
                }
            },
            {
                "box": {
                    "id": "obj-23006",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2216.0, 1946.0, 180.0, 22.0 ],
                    "text": "receive gain_melody"
                }
            },
            {
                "box": {
                    "id": "obj-23007",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 2106.0, 1946.0, 52.0, 22.0 ],
                    "text": "*~ 1"
                }
            },
            {
                "box": {
                    "id": "obj-23008",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 540.0, 2102.0, 131.4285860657692, 22.0 ],
                    "text": "receive fxsend_vocals"
                }
            },
            {
                "box": {
                    "id": "obj-23009",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 540.0, 2144.0, 52.0, 22.0 ],
                    "text": "*~ 0"
                }
            },
            {
                "box": {
                    "id": "obj-230010",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 1140.0, 2102.0, 130.76194095611572, 22.0 ],
                    "text": "receive fxsend_drums"
                }
            },
            {
                "box": {
                    "id": "obj-230011",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1140.0, 2144.0, 52.0, 22.0 ],
                    "text": "*~ 0"
                }
            },
            {
                "box": {
                    "id": "obj-230012",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 1768.0, 2102.0, 129.783549785614, 22.0 ],
                    "text": "receive fxsend_bass"
                }
            },
            {
                "box": {
                    "id": "obj-230013",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1768.0, 2144.0, 52.0, 22.0 ],
                    "text": "*~ 0"
                }
            },
            {
                "box": {
                    "id": "obj-230014",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2324.0, 2102.0, 136.3636350631714, 22.0 ],
                    "text": "receive fxsend_melody"
                }
            },
            {
                "box": {
                    "id": "obj-230015",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 2326.0, 2140.0, 52.0, 22.0 ],
                    "text": "*~ 0"
                }
            },
            {
                "box": {
                    "id": "obj-23019",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 1288.0, 3156.0, 149.0, 22.0 ],
                    "text": "receive master_gain"
                }
            },
            {
                "box": {
                    "id": "obj-23020",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5123.577875614166, 716.6666034460068, 150.0, 22.0 ],
                    "text": "send gain_vocals"
                }
            },
            {
                "box": {
                    "id": "obj-23021",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5299.33543586731, 716.6666034460068, 150.0, 22.0 ],
                    "text": "send gain_drums"
                }
            },
            {
                "box": {
                    "id": "obj-23022",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5482.668753027916, 716.6666034460068, 140.9998333454132, 22.0 ],
                    "text": "send gain_bass"
                }
            },
            {
                "box": {
                    "id": "obj-23023",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5682.668735384941, 716.6666034460068, 158.0, 22.0 ],
                    "text": "send gain_melody"
                }
            },
            {
                "box": {
                    "id": "obj-23024",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5946.0678906440735, 1132.5843601226807, 108.98877274990082, 22.0 ],
                    "text": "send master_gain"
                }
            },
            {
                "box": {
                    "id": "obj-23025",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5395.50604891777, 1069.6630067825317, 127.61559238433892, 22.0 ],
                    "text": "send fxsend_vocals"
                }
            },
            {
                "box": {
                    "id": "obj-23026",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5395.50604891777, 1098.8764922618866, 127.61559238433892, 22.0 ],
                    "text": "send fxsend_drums"
                }
            },
            {
                "box": {
                    "id": "obj-23027",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5395.50604891777, 1126.9663821458817, 126.20376710891742, 22.0 ],
                    "text": "send fxsend_bass"
                }
            },
            {
                "box": {
                    "id": "obj-23028",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5395.50604891777, 1158.4270588159561, 126.0, 22.0 ],
                    "text": "send fxsend_melody"
                }
            },
            {
                "box": {
                    "id": "obj-230017",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 382.0, 1988.0, 140.0, 22.0 ],
                    "text": "receive fader_vocals"
                }
            },
            {
                "box": {
                    "id": "obj-230018",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 274.0, 2008.0, 52.0, 22.0 ],
                    "text": "*~ 1"
                }
            },
            {
                "box": {
                    "id": "obj-230019",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5123.577875614166, 746.9696310758591, 150.0, 22.0 ],
                    "text": "send fader_vocals"
                }
            },
            {
                "box": {
                    "id": "obj-230020",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 1026.0, 1988.0, 140.0, 22.0 ],
                    "text": "receive fader_drums"
                }
            },
            {
                "box": {
                    "id": "obj-230021",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 920.0, 2008.0, 52.0, 22.0 ],
                    "text": "*~ 1"
                }
            },
            {
                "box": {
                    "id": "obj-230022",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5873.577809453011, 743.9393283128738, 134.0, 22.0 ],
                    "text": "send fader_drums"
                }
            },
            {
                "box": {
                    "id": "obj-230023",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 1660.0, 1988.0, 140.0, 22.0 ],
                    "text": "receive fader_bass"
                }
            },
            {
                "box": {
                    "id": "obj-230024",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1546.0, 2008.0, 52.0, 22.0 ],
                    "text": "*~ 1"
                }
            },
            {
                "box": {
                    "id": "obj-230025",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 6025.092947602272, 716.6666034460068, 130.0, 22.0 ],
                    "text": "send fader_bass"
                }
            },
            {
                "box": {
                    "id": "obj-230026",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2216.0, 1988.0, 140.0, 22.0 ],
                    "text": "receive fader_melody"
                }
            },
            {
                "box": {
                    "id": "obj-230027",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 2106.0, 2008.0, 52.0, 22.0 ],
                    "text": "*~ 1"
                }
            },
            {
                "box": {
                    "id": "obj-230028",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 6025.092947602272, 743.9393283128738, 130.0, 22.0 ],
                    "text": "send fader_melody"
                }
            },
            {
                "box": {
                    "id": "obj-230029",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 0,
                    "patching_rect": [ 540.0, 2182.0, 70.0, 22.0 ],
                    "text": "dac~ 7 8"
                }
            },
            {
                "box": {
                    "id": "obj-230030",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "signal" ],
                    "patching_rect": [ 598.0, 2288.0, 69.33333539962769, 22.0 ],
                    "text": "adc~ 7 8"
                }
            },
            {
                "box": {
                    "id": "obj-230034",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5534.831902742386, 1069.6630067825317, 160.0, 22.0 ],
                    "text": "send fxreturn_vocals"
                }
            },
            {
                "box": {
                    "id": "obj-230035",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 0,
                    "patching_rect": [ 1140.0, 2182.0, 70.0, 22.0 ],
                    "text": "dac~ 9 10"
                }
            },
            {
                "box": {
                    "id": "obj-230036",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "signal" ],
                    "patching_rect": [ 1188.0, 2288.0, 80.0, 22.0 ],
                    "text": "adc~ 9 10"
                }
            },
            {
                "box": {
                    "id": "obj-230040",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5534.831902742386, 1098.8764922618866, 160.0, 22.0 ],
                    "text": "send fxreturn_drums"
                }
            },
            {
                "box": {
                    "id": "obj-230041",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 0,
                    "patching_rect": [ 1768.0, 2174.0, 70.0, 22.0 ],
                    "text": "dac~ 11 12"
                }
            },
            {
                "box": {
                    "id": "obj-230042",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "signal" ],
                    "patching_rect": [ 1820.0, 2288.0, 80.0, 22.0 ],
                    "text": "adc~ 11 12"
                }
            },
            {
                "box": {
                    "id": "obj-230046",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5534.831902742386, 1126.9663821458817, 160.0, 22.0 ],
                    "text": "send fxreturn_bass"
                }
            },
            {
                "box": {
                    "id": "obj-230047",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 0,
                    "patching_rect": [ 2326.0, 2174.0, 70.0, 22.0 ],
                    "text": "dac~ 13 14"
                }
            },
            {
                "box": {
                    "id": "obj-230048",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "signal" ],
                    "patching_rect": [ 2382.0, 2284.0, 80.0, 22.0 ],
                    "text": "adc~ 13 14"
                }
            },
            {
                "box": {
                    "id": "obj-230052",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5534.831902742386, 1158.4270588159561, 160.0, 22.0 ],
                    "text": "send fxreturn_melody"
                }
            },
            {
                "box": {
                    "id": "obj-230060",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 1070.0, 3654.0, 70.0, 22.0 ],
                    "text": "dac~ 3"
                }
            },
            {
                "box": {
                    "id": "obj-230061",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 1164.0, 3654.0, 70.0, 22.0 ],
                    "text": "dac~ 4"
                }
            },
            {
                "box": {
                    "id": "obj-230062",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 1246.0, 3654.0, 70.0, 22.0 ],
                    "text": "dac~ 5"
                }
            },
            {
                "box": {
                    "id": "obj-230063",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 1340.0, 3654.0, 70.0, 22.0 ],
                    "text": "dac~ 6"
                }
            },
            {
                "box": {
                    "id": "obj-230068",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": [ "", "" ],
                    "patching_rect": [ 2382.0, 2656.0, 98.0, 22.0 ],
                    "text": "fluid.loudness~"
                }
            },
            {
                "box": {
                    "id": "obj-snd_mpFront",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 6064.045428156853, 1132.5843601226807, 108.98877274990082, 22.0 ],
                    "text": "send masterJoyX"
                }
            },
            {
                "box": {
                    "id": "obj-snd_mpRear",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 6064.045428156853, 1164.0450367927551, 108.98877274990082, 22.0 ],
                    "text": "send masterJoyY"
                }
            },
            {
                "box": {
                    "id": "obj-rcv_joyX_vocals",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 482.0, 2426.0, 140.0, 22.0 ],
                    "text": "receive joyX_vocals"
                }
            },
            {
                "box": {
                    "id": "obj-rcv_joyY_vocals",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 482.0, 2454.0, 140.0, 22.0 ],
                    "text": "receive joyY_vocals"
                }
            },
            {
                "box": {
                    "id": "obj-jp_LR_L_vocals",
                    "maxclass": "newobj",
                    "numinlets": 4,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "signal" ],
                    "patching_rect": [ 236.0, 2482.0, 50.5, 22.0 ],
                    "text": "pan2"
                }
            },
            {
                "box": {
                    "id": "obj-jp_FL_L_vocals",
                    "maxclass": "newobj",
                    "numinlets": 4,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "signal" ],
                    "patching_rect": [ 236.0, 2540.0, 50.5, 22.0 ],
                    "text": "pan2"
                }
            },
            {
                "box": {
                    "id": "obj-jp_FR_L_vocals",
                    "maxclass": "newobj",
                    "numinlets": 4,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "signal" ],
                    "patching_rect": [ 296.0, 2540.0, 50.5, 22.0 ],
                    "text": "pan2"
                }
            },
            {
                "box": {
                    "id": "obj-jp_LR_R_vocals",
                    "maxclass": "newobj",
                    "numinlets": 4,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "signal" ],
                    "patching_rect": [ 384.0, 2482.0, 50.5, 22.0 ],
                    "text": "pan2"
                }
            },
            {
                "box": {
                    "id": "obj-jp_FL_R_vocals",
                    "maxclass": "newobj",
                    "numinlets": 4,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "signal" ],
                    "patching_rect": [ 384.0, 2540.0, 50.5, 22.0 ],
                    "text": "pan2"
                }
            },
            {
                "box": {
                    "id": "obj-jp_FR_R_vocals",
                    "maxclass": "newobj",
                    "numinlets": 4,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "signal" ],
                    "patching_rect": [ 446.0, 2540.0, 50.5, 22.0 ],
                    "text": "pan2"
                }
            },
            {
                "box": {
                    "id": "obj-rcv_joyX_drums",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 1140.0, 2426.0, 131.0, 22.0 ],
                    "text": "receive joyX_drums"
                }
            },
            {
                "box": {
                    "id": "obj-rcv_joyY_drums",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 1140.0, 2460.0, 131.0, 22.0 ],
                    "text": "receive joyY_drums"
                }
            },
            {
                "box": {
                    "id": "obj-jp_LR_L_drums",
                    "maxclass": "newobj",
                    "numinlets": 4,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "signal" ],
                    "patching_rect": [ 822.0, 2482.0, 50.5, 22.0 ],
                    "text": "pan2"
                }
            },
            {
                "box": {
                    "id": "obj-jp_FL_L_drums",
                    "maxclass": "newobj",
                    "numinlets": 4,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "signal" ],
                    "patching_rect": [ 802.0, 2544.0, 50.5, 22.0 ],
                    "text": "pan2"
                }
            },
            {
                "box": {
                    "id": "obj-jp_FR_L_drums",
                    "maxclass": "newobj",
                    "numinlets": 4,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "signal" ],
                    "patching_rect": [ 858.0, 2544.0, 50.5, 22.0 ],
                    "text": "pan2"
                }
            },
            {
                "box": {
                    "id": "obj-jp_LR_R_drums",
                    "maxclass": "newobj",
                    "numinlets": 4,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "signal" ],
                    "patching_rect": [ 984.0, 2482.0, 50.5, 22.0 ],
                    "text": "pan2"
                }
            },
            {
                "box": {
                    "id": "obj-jp_FL_R_drums",
                    "maxclass": "newobj",
                    "numinlets": 4,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "signal" ],
                    "patching_rect": [ 964.0, 2544.0, 50.5, 22.0 ],
                    "text": "pan2"
                }
            },
            {
                "box": {
                    "id": "obj-jp_FR_R_drums",
                    "maxclass": "newobj",
                    "numinlets": 4,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "signal" ],
                    "patching_rect": [ 1020.0, 2544.0, 50.5, 22.0 ],
                    "text": "pan2"
                }
            },
            {
                "box": {
                    "id": "obj-rcv_joyX_bass",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 1768.0, 2426.0, 130.0000038743019, 22.0 ],
                    "text": "receive joyX_bass"
                }
            },
            {
                "box": {
                    "id": "obj-rcv_joyY_bass",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 1768.0, 2460.0, 130.0000038743019, 22.0 ],
                    "text": "receive joyY_bass"
                }
            },
            {
                "box": {
                    "id": "obj-jp_LR_L_bass",
                    "maxclass": "newobj",
                    "numinlets": 4,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "signal" ],
                    "patching_rect": [ 1440.0, 2474.0, 50.5, 22.0 ],
                    "text": "pan2"
                }
            },
            {
                "box": {
                    "id": "obj-jp_FL_L_bass",
                    "maxclass": "newobj",
                    "numinlets": 4,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "signal" ],
                    "patching_rect": [ 1420.0, 2540.0, 50.5, 22.0 ],
                    "text": "pan2"
                }
            },
            {
                "box": {
                    "id": "obj-jp_FR_L_bass",
                    "maxclass": "newobj",
                    "numinlets": 4,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "signal" ],
                    "patching_rect": [ 1474.0, 2540.0, 50.5, 22.0 ],
                    "text": "pan2"
                }
            },
            {
                "box": {
                    "id": "obj-jp_LR_R_bass",
                    "maxclass": "newobj",
                    "numinlets": 4,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "signal" ],
                    "patching_rect": [ 1612.0, 2474.0, 50.5, 22.0 ],
                    "text": "pan2"
                }
            },
            {
                "box": {
                    "id": "obj-jp_FL_R_bass",
                    "maxclass": "newobj",
                    "numinlets": 4,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "signal" ],
                    "patching_rect": [ 1588.0, 2540.0, 50.5, 22.0 ],
                    "text": "pan2"
                }
            },
            {
                "box": {
                    "id": "obj-jp_FR_R_bass",
                    "maxclass": "newobj",
                    "numinlets": 4,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "signal" ],
                    "patching_rect": [ 1644.0, 2540.0, 50.5, 22.0 ],
                    "text": "pan2"
                }
            },
            {
                "box": {
                    "id": "obj-rcv_joyX_melody",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2322.0, 2426.0, 140.0, 22.0 ],
                    "text": "receive joyX_melody"
                }
            },
            {
                "box": {
                    "id": "obj-rcv_joyY_melody",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2322.0, 2460.0, 140.0, 22.0 ],
                    "text": "receive joyY_melody"
                }
            },
            {
                "box": {
                    "id": "obj-jp_LR_L_melody",
                    "maxclass": "newobj",
                    "numinlets": 4,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "signal" ],
                    "patching_rect": [ 1998.0, 2482.0, 50.5, 22.0 ],
                    "text": "pan2"
                }
            },
            {
                "box": {
                    "id": "obj-jp_FL_L_melody",
                    "maxclass": "newobj",
                    "numinlets": 4,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "signal" ],
                    "patching_rect": [ 1974.0, 2540.0, 50.5, 22.0 ],
                    "text": "pan2"
                }
            },
            {
                "box": {
                    "id": "obj-jp_FR_L_melody",
                    "maxclass": "newobj",
                    "numinlets": 4,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "signal" ],
                    "patching_rect": [ 2026.0, 2540.0, 50.5, 22.0 ],
                    "text": "pan2"
                }
            },
            {
                "box": {
                    "id": "obj-jp_LR_R_melody",
                    "maxclass": "newobj",
                    "numinlets": 4,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "signal" ],
                    "patching_rect": [ 2168.0, 2482.0, 50.5, 22.0 ],
                    "text": "pan2"
                }
            },
            {
                "box": {
                    "id": "obj-jp_FL_R_melody",
                    "maxclass": "newobj",
                    "numinlets": 4,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "signal" ],
                    "patching_rect": [ 2144.0, 2540.0, 50.5, 22.0 ],
                    "text": "pan2"
                }
            },
            {
                "box": {
                    "id": "obj-jp_FR_R_melody",
                    "maxclass": "newobj",
                    "numinlets": 4,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "signal" ],
                    "patching_rect": [ 2198.0, 2540.0, 50.5, 22.0 ],
                    "text": "pan2"
                }
            },
            {
                "box": {
                    "id": "obj-jpsum_FL_vocals",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 726.0, 2622.0, 30.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-jpsum_FL_drums",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 778.0, 2622.0, 30.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-jpsum_FL_bass",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 826.0, 2622.0, 30.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-jpsum_FL_melody",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 878.0, 2622.0, 30.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-jpsum2_FL_vd",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 746.0, 2668.0, 30.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-jpsum2_FL_bm",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 846.0, 2668.0, 30.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-jpfinal_FL",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 796.0, 2722.0, 30.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-jpsum_FR_vocals",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 978.0, 2622.0, 30.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-jpsum_FR_drums",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1026.0, 2622.0, 30.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-jpsum_FR_bass",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1078.0, 2622.0, 30.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-jpsum_FR_melody",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1126.0, 2622.0, 30.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-jpsum2_FR_vd",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 998.0, 2668.0, 30.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-jpsum2_FR_bm",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1098.0, 2668.0, 30.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-jpfinal_FR",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1044.0, 2722.0, 30.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-jpsum_RL_vocals",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1226.0, 2622.0, 30.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-jpsum_RL_drums",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1278.0, 2622.0, 30.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-jpsum_RL_bass",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1326.0, 2622.0, 30.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-jpsum_RL_melody",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1378.0, 2622.0, 30.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-jpsum2_RL_vd",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1246.0, 2668.0, 30.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-jpsum2_RL_bm",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1354.0, 2668.0, 30.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-jpfinal_RL",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1298.0, 2722.0, 30.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-jpsum_RR_vocals",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1478.0, 2622.0, 30.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-jpsum_RR_drums",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1526.0, 2622.0, 30.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-jpsum_RR_bass",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1578.0, 2622.0, 30.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-jpsum_RR_melody",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1626.0, 2622.0, 30.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-jpsum2_RR_vd",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1498.0, 2668.0, 30.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-jpsum2_RR_bm",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1598.0, 2668.0, 30.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-jpfinal_RR",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1546.0, 2722.0, 30.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-jpk_FL",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "float" ],
                    "patching_rect": [ 796.0, 2782.0, 110.0, 22.0 ],
                    "text": "peakamp~ 4096"
                }
            },
            {
                "box": {
                    "id": "obj-jpre_FL",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 796.0, 2808.0, 120.0, 22.0 ],
                    "text": "prepend meter FL"
                }
            },
            {
                "box": {
                    "id": "obj-jpk_FR",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "float" ],
                    "patching_rect": [ 1044.0, 2782.0, 110.0, 22.0 ],
                    "text": "peakamp~ 4096"
                }
            },
            {
                "box": {
                    "id": "obj-jpre_FR",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 1044.0, 2808.0, 120.0, 22.0 ],
                    "text": "prepend meter FR"
                }
            },
            {
                "box": {
                    "id": "obj-jpk_RL",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "float" ],
                    "patching_rect": [ 1298.0, 2782.0, 110.0, 22.0 ],
                    "text": "peakamp~ 4096"
                }
            },
            {
                "box": {
                    "id": "obj-jpre_RL",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 1298.0, 2808.0, 120.0, 22.0 ],
                    "text": "prepend meter RL"
                }
            },
            {
                "box": {
                    "id": "obj-jpk_RR",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "float" ],
                    "patching_rect": [ 1546.0, 2782.0, 110.0, 22.0 ],
                    "text": "peakamp~ 4096"
                }
            },
            {
                "box": {
                    "id": "obj-jpre_RR",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 1546.0, 2808.0, 120.0, 22.0 ],
                    "text": "prepend meter RR"
                }
            },
            {
                "box": {
                    "id": "obj-jpsend_joyX_vocals",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5703.371242046356, 1068.539411187172, 108.98877274990082, 22.0 ],
                    "text": "send joyX_vocals"
                }
            },
            {
                "box": {
                    "id": "obj-jpsend_joyY_vocals",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5703.371242046356, 1097.7528966665268, 108.98877274990082, 22.0 ],
                    "text": "send joyY_vocals"
                }
            },
            {
                "box": {
                    "id": "obj-jpsend_joyX_drums",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5826.966757535934, 1068.539411187172, 108.98877274990082, 22.0 ],
                    "text": "send joyX_drums"
                }
            },
            {
                "box": {
                    "id": "obj-jpsend_joyY_drums",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5826.966757535934, 1097.7528966665268, 108.98877274990082, 22.0 ],
                    "text": "send joyY_drums"
                }
            },
            {
                "box": {
                    "id": "obj-jpsend_joyX_bass",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5946.0678906440735, 1068.539411187172, 108.98877274990082, 22.0 ],
                    "text": "send joyX_bass"
                }
            },
            {
                "box": {
                    "id": "obj-jpsend_joyY_bass",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5946.0678906440735, 1097.7528966665268, 108.98877274990082, 22.0 ],
                    "text": "send joyY_bass"
                }
            },
            {
                "box": {
                    "id": "obj-jpsend_joyX_melody",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 6064.045428156853, 1068.539411187172, 108.98877274990082, 22.0 ],
                    "text": "send joyX_melody"
                }
            },
            {
                "box": {
                    "id": "obj-jpsend_joyY_melody",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 6064.045428156853, 1097.7528966665268, 108.98877274990082, 22.0 ],
                    "text": "send joyY_melody"
                }
            },
            {
                "box": {
                    "id": "obj-mj_sum_L",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 936.0, 2902.0, 30.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-mj_sum_R",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1396.0, 2902.0, 30.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-mj_LR_L",
                    "maxclass": "newobj",
                    "numinlets": 4,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "signal" ],
                    "patching_rect": [ 936.0, 2954.0, 40.0, 22.0 ],
                    "text": "pan2"
                }
            },
            {
                "box": {
                    "id": "obj-mj_LR_R",
                    "maxclass": "newobj",
                    "numinlets": 4,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "signal" ],
                    "patching_rect": [ 1396.0, 2956.0, 40.0, 22.0 ],
                    "text": "pan2"
                }
            },
            {
                "box": {
                    "id": "obj-mj_FL_L",
                    "maxclass": "newobj",
                    "numinlets": 4,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "signal" ],
                    "patching_rect": [ 912.0, 3012.0, 40.0, 22.0 ],
                    "text": "pan2"
                }
            },
            {
                "box": {
                    "id": "obj-mj_FR_L",
                    "maxclass": "newobj",
                    "numinlets": 4,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "signal" ],
                    "patching_rect": [ 984.0, 3012.0, 40.0, 22.0 ],
                    "text": "pan2"
                }
            },
            {
                "box": {
                    "id": "obj-mj_FL_R",
                    "maxclass": "newobj",
                    "numinlets": 4,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "signal" ],
                    "patching_rect": [ 1368.0, 3012.0, 40.0, 22.0 ],
                    "text": "pan2"
                }
            },
            {
                "box": {
                    "id": "obj-mj_FR_R",
                    "maxclass": "newobj",
                    "numinlets": 4,
                    "numoutlets": 2,
                    "outlettype": [ "signal", "signal" ],
                    "patching_rect": [ 1440.0, 3012.0, 40.0, 22.0 ],
                    "text": "pan2"
                }
            },
            {
                "box": {
                    "id": "obj-mj_final_FL",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 912.0, 3068.0, 30.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-mj_final_FR",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 984.0, 3068.0, 30.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-mj_final_RL",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1368.0, 3068.0, 30.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-mj_final_RR",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1440.0, 3068.0, 30.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-rcv_masterJoyX",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 1458.0, 2902.0, 150.0, 22.0 ],
                    "text": "receive masterJoyX"
                }
            },
            {
                "box": {
                    "id": "obj-rcv_masterJoyY",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 1458.0, 2956.0, 150.0, 22.0 ],
                    "text": "receive masterJoyY"
                }
            },
            {
                "box": {
                    "id": "obj-stereo_sum_L",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1144.0, 3156.0, 40.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-stereo_sum_R",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1220.0, 3156.0, 40.0, 22.0 ],
                    "text": "+~"
                }
            },
            {
                "box": {
                    "id": "obj-fxret_rcv_vocals",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 536.0, 2254.0, 132.0, 22.0 ],
                    "text": "receive fxreturn_vocals"
                }
            },
            {
                "box": {
                    "id": "obj-fxret_gL_vocals",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 236.0, 2332.0, 40.0, 22.0 ],
                    "text": "*~"
                }
            },
            {
                "box": {
                    "id": "obj-fxret_gR_vocals",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 384.0, 2332.0, 40.0, 22.0 ],
                    "text": "*~"
                }
            },
            {
                "box": {
                    "id": "obj-fxret_rcv_drums",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 1140.0, 2254.0, 131.0, 22.0 ],
                    "text": "receive fxreturn_drums"
                }
            },
            {
                "box": {
                    "id": "obj-fxret_gL_drums",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 822.0, 2332.0, 40.0, 22.0 ],
                    "text": "*~"
                }
            },
            {
                "box": {
                    "id": "obj-fxret_gR_drums",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 984.0, 2332.0, 40.0, 22.0 ],
                    "text": "*~"
                }
            },
            {
                "box": {
                    "id": "obj-fxret_rcv_bass",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 1768.0, 2254.0, 130.0, 22.0 ],
                    "text": "receive fxreturn_bass"
                }
            },
            {
                "box": {
                    "id": "obj-fxret_gL_bass",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1440.0, 2332.0, 40.0, 22.0 ],
                    "text": "*~"
                }
            },
            {
                "box": {
                    "id": "obj-fxret_gR_bass",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1612.0, 2332.0, 40.0, 22.0 ],
                    "text": "*~"
                }
            },
            {
                "box": {
                    "id": "obj-fxret_rcv_melody",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [ "" ],
                    "patching_rect": [ 2326.0, 2254.0, 137.0, 22.0 ],
                    "text": "receive fxreturn_melody"
                }
            },
            {
                "box": {
                    "id": "obj-fxret_gL_melody",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 1998.0, 2332.0, 40.0, 22.0 ],
                    "text": "*~"
                }
            },
            {
                "box": {
                    "id": "obj-fxret_gR_melody",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": [ "signal" ],
                    "patching_rect": [ 2168.0, 2332.0, 40.0, 22.0 ],
                    "text": "*~"
                }
            },
            {
                "box": {
                    "fontface": 1,
                    "id": "lbl_stem_vocals",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 154.0, 1244.0, 120.0, 20.0 ],
                    "text": "── VOCALS ──",
                    "textcolor": [ 0.7215686274509804, 0.7215686274509804, 0.7215686274509804, 1.0 ]
                }
            },
            {
                "box": {
                    "fontface": 1,
                    "id": "lbl_stem_drums",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 726.0, 1246.0, 98.76543998718262, 20.0 ],
                    "text": "── DRUMS ──",
                    "textcolor": [ 0.7215686274509804, 0.7215686274509804, 0.7215686274509804, 1.0 ]
                }
            },
            {
                "box": {
                    "fontface": 1,
                    "id": "lbl_stem_bass",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 1320.0, 1246.0, 90.12346398830414, 20.0 ],
                    "text": "── BASS ──",
                    "textcolor": [ 0.7215686274509804, 0.7215686274509804, 0.7215686274509804, 1.0 ]
                }
            },
            {
                "box": {
                    "fontface": 1,
                    "id": "lbl_stem_melody",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 1934.0, 1246.0, 108.64198398590088, 20.0 ],
                    "text": "── MELODY ──",
                    "textcolor": [ 0.7215686274509804, 0.7215686274509804, 0.7215686274509804, 1.0 ]
                }
            },
            {
                "box": {
                    "fontface": 1,
                    "fontsize": 12.0,
                    "id": "lbl_fxsend",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 134.0, 2074.0, 822.7893153429031, 20.0 ],
                    "text": "== WIDTH / STEREO SPREAD  +  FX SEND == fader → Haas delay (delay~ 512) × width_*→ per-stem dry send to hardware inserts  (dac~ 7–14)",
                    "textcolor": [ 1.0, 1.0, 1.0, 1.0 ]
                }
            },
            {
                "box": {
                    "fontface": 1,
                    "fontsize": 12.0,
                    "id": "lbl_fxreturn",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 134.0, 2230.0, 538.1096487641335, 20.0 ],
                    "text": "== FX RETURN == adc~ 7–14 → *~ (fxreturn_* level) → mixed into stem path before panning",
                    "textcolor": [ 1.0, 1.0, 1.0, 1.0 ]
                }
            },
            {
                "box": {
                    "fontface": 1,
                    "fontsize": 12.0,
                    "id": "lbl_pan2",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 134.0, 2388.0, 823.0, 20.0 ],
                    "text": "== 2D PANNING ==  L/R split  →  pan2 LR (joyX)  →  pan2 FB (joyY)",
                    "textcolor": [ 1.0, 1.0, 1.0, 1.0 ]
                }
            },
            {
                "box": {
                    "fontface": 0,
                    "fontsize": 10.0,
                    "id": "lbl_pan2_lr",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 288.0, 2482.0, 180.0, 18.0 ],
                    "text": "LR stage (joyX)",
                    "textcolor": [ 0.75, 0.75, 0.75, 1.0 ]
                }
            },
            {
                "box": {
                    "fontface": 0,
                    "fontsize": 10.0,
                    "id": "lbl_pan2_fb",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 502.0, 2544.0, 180.0, 18.0 ],
                    "text": "FB stage (joyY)",
                    "textcolor": [ 0.75, 0.75, 0.75, 1.0 ]
                }
            },
            {
                "box": {
                    "fontface": 1,
                    "fontsize": 12.0,
                    "id": "lbl_sums",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 134.0, 2602.0, 442.96875, 20.0 ],
                    "text": "== STEM SUM BUSES == 4 stems × 4 channels → jpfinal FL / FR / RL / RR",
                    "textcolor": [ 1.0, 1.0, 1.0, 1.0 ]
                }
            },
            {
                "box": {
                    "fontface": 1,
                    "fontsize": 12.0,
                    "id": "lbl_master",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 130.0, 2874.0, 650.0, 20.0 ],
                    "text": "== MASTER 2D PAN == sums FL+RL and FR+RR content → pan2 joystick chain (masterJoyX / masterJoyY)",
                    "textcolor": [ 1.0, 1.0, 1.0, 1.0 ]
                }
            },
            {
                "box": {
                    "fontface": 0,
                    "fontsize": 10.0,
                    "id": "lbl_master_lr",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 770.0, 2956.0, 130.95237970352173, 18.0 ],
                    "text": "LR rotation (masterJoyX)",
                    "textcolor": [ 0.75, 0.75, 0.75, 1.0 ]
                }
            },
            {
                "box": {
                    "fontface": 0,
                    "fontsize": 10.0,
                    "id": "lbl_master_fb",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 770.0, 3012.0, 128.57142734527588, 18.0 ],
                    "text": "FB rotation (masterJoyY)",
                    "textcolor": [ 0.75, 0.75, 0.75, 1.0 ]
                }
            },
            {
                "box": {
                    "fontface": 1,
                    "fontsize": 12.0,
                    "id": "lbl_stereo",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 130.0, 3136.0, 457.1428527832031, 20.0 ],
                    "text": "== STEREO OUT == FL+RL → L FR+RR → R × master_gain → dac~ 1 2",
                    "textcolor": [ 1.0, 1.0, 1.0, 1.0 ]
                }
            },
            {
                "box": {
                    "fontface": 1,
                    "id": "lbl_4ch",
                    "maxclass": "comment",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 130.0, 3460.0, 410.0, 20.0 ],
                    "text": "== 4CH SPATIAL OUT  ==  FL=dac~3  FR=dac~4  RL=dac~5  RR=dac~6",
                    "textcolor": [ 1.0, 1.0, 1.0, 1.0 ]
                }
            },
            {
                "box": {
                    "angle": 270.0,
                    "background": 1,
                    "bgcolor": [ 0.0, 0.18, 0.22, 0.0 ],
                    "border": 2,
                    "bordercolor": [ 1.0, 1.0, 1.0, 1.0 ],
                    "id": "obj-188",
                    "maxclass": "panel",
                    "mode": 0,
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5080.302582144737, 480.3029879331589, 1126.5462815761566, 746.9696310758591 ],
                    "proportion": 0.5
                }
            },
            {
                "box": {
                    "angle": 270.0,
                    "background": 1,
                    "bgcolor": [ 0.0, 0.18, 0.22, 0.0 ],
                    "border": 2,
                    "bordercolor": [ 1.0, 1.0, 1.0, 1.0 ],
                    "id": "obj-184",
                    "maxclass": "panel",
                    "mode": 0,
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 5080.821548342705, 72.60273444652557, 1126.027315378189, 395.14194321632385 ],
                    "proportion": 0.5
                }
            },
            {
                "box": {
                    "angle": 270.0,
                    "background": 1,
                    "bgcolor": [ 0.0, 0.18, 0.22, 0.0 ],
                    "border": 2,
                    "bordercolor": [ 1.0, 1.0, 1.0, 1.0 ],
                    "id": "obj-183",
                    "maxclass": "panel",
                    "mode": 0,
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 2524.46806704998, 72.34042501449585, 2543.328498482704, 3070.4917154312134 ],
                    "proportion": 0.5
                }
            },
            {
                "box": {
                    "angle": 270.0,
                    "background": 1,
                    "bgcolor": [ 0.0, 0.18, 0.22, 0.0 ],
                    "border": 2,
                    "bordercolor": [ 1.0, 1.0, 1.0, 1.0 ],
                    "id": "obj-180",
                    "maxclass": "panel",
                    "mode": 0,
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 122.0, 765.0, 2392.7379212379456, 258.0 ],
                    "proportion": 0.5
                }
            },
            {
                "box": {
                    "angle": 270.0,
                    "background": 1,
                    "bgcolor": [ 0.25, 0.2, 0.0, 0.0 ],
                    "border": 2,
                    "bordercolor": [ 1.0, 1.0, 1.0, 1.0 ],
                    "id": "obj-62",
                    "maxclass": "panel",
                    "mode": 0,
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 2008.0, 2598.0, 506.7416135072708, 256.1797957420349 ],
                    "proportion": 0.5
                }
            },
            {
                "box": {
                    "angle": 270.0,
                    "background": 1,
                    "bgcolor": [ 0.28, 0.17, 0.0, 0.0 ],
                    "border": 2,
                    "bordercolor": [ 1.0, 1.0, 1.0, 1.0 ],
                    "id": "obj-51",
                    "maxclass": "panel",
                    "mode": 0,
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 120.68966150283813, 72.41379690170288, 2394.0297651290894, 259.7014832496643 ],
                    "proportion": 0.5
                }
            },
            {
                "box": {
                    "angle": 270.0,
                    "background": 1,
                    "bgcolor": [ 0.25, 0.2, 0.0, 0.0 ],
                    "border": 2,
                    "bordercolor": [ 1.0, 1.0, 1.0, 1.0 ],
                    "id": "obj-48",
                    "maxclass": "panel",
                    "mode": 0,
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 122.0, 2764.0, 1874.9999821186066, 90.47618961334229 ],
                    "proportion": 0.5
                }
            },
            {
                "box": {
                    "angle": 270.0,
                    "background": 1,
                    "bgcolor": [ 0.28, 0.17, 0.0, 0.0 ],
                    "border": 2,
                    "bordercolor": [ 1.0, 1.0, 1.0, 1.0 ],
                    "id": "obj-47",
                    "maxclass": "panel",
                    "mode": 0,
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 120.68966150283813, 341.379328250885, 2394.3647418022156, 256.97262835502625 ],
                    "proportion": 0.5
                }
            },
            {
                "box": {
                    "angle": 270.0,
                    "background": 1,
                    "bgcolor": [ 0.28, 0.17, 0.0, 0.0 ],
                    "border": 2,
                    "bordercolor": [ 1.0, 1.0, 1.0, 1.0 ],
                    "id": "obj-46",
                    "maxclass": "panel",
                    "mode": 0,
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 120.68966150283813, 606.8965835571289, 2392.7379212379456, 146.6350440979004 ],
                    "proportion": 0.5
                }
            },
            {
                "box": {
                    "angle": 270.0,
                    "background": 1,
                    "bgcolor": [ 0.28, 0.17, 0.0, 0.0 ],
                    "border": 2,
                    "bordercolor": [ 1.0, 1.0, 1.0, 1.0 ],
                    "id": "obj-42",
                    "maxclass": "panel",
                    "mode": 0,
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 122.0, 1035.0, 2392.7379212379456, 146.6350440979004 ],
                    "proportion": 0.5
                }
            },
            {
                "box": {
                    "angle": 270.0,
                    "background": 1,
                    "bgcolor": [ 0.28, 0.17, 0.0, 0.0 ],
                    "border": 2,
                    "bordercolor": [ 1.0, 1.0, 1.0, 1.0 ],
                    "id": "pnl_fxsend",
                    "maxclass": "panel",
                    "mode": 0,
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 122.0, 2070.0, 2390.1236476898193, 140.74075198173523 ],
                    "proportion": 0.5
                }
            },
            {
                "box": {
                    "angle": 270.0,
                    "background": 1,
                    "bgcolor": [ 0.0, 0.0, 0.0, 0.0 ],
                    "border": 2,
                    "bordercolor": [ 1.0, 1.0, 1.0, 1.0 ],
                    "id": "pnl_fxreturn",
                    "maxclass": "panel",
                    "mode": 0,
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 122.0, 2222.0, 2390.1236476898193, 150.6172959804535 ],
                    "proportion": 0.5
                }
            },
            {
                "box": {
                    "angle": 270.0,
                    "background": 1,
                    "bgcolor": [ 1.0, 1.0, 1.0, 0.0 ],
                    "border": 2,
                    "bordercolor": [ 1.0, 1.0, 1.0, 1.0 ],
                    "id": "pnl_pan2",
                    "maxclass": "panel",
                    "mode": 0,
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 122.0, 2384.0, 2391.358215689659, 201.23458397388458 ],
                    "proportion": 0.5
                }
            },
            {
                "box": {
                    "angle": 270.0,
                    "background": 1,
                    "bgcolor": [ 0.15, 0.0, 0.28, 0.0 ],
                    "border": 2,
                    "bordercolor": [ 1.0, 1.0, 1.0, 1.0 ],
                    "id": "pnl_sums",
                    "maxclass": "panel",
                    "mode": 0,
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 122.0, 2600.0, 1875.1682261228561, 153.38819205760956 ],
                    "proportion": 0.5
                }
            },
            {
                "box": {
                    "angle": 270.0,
                    "background": 1,
                    "bgcolor": [ 0.25, 0.2, 0.0, 0.0 ],
                    "border": 2,
                    "bordercolor": [ 1.0, 1.0, 1.0, 1.0 ],
                    "id": "pnl_master",
                    "maxclass": "panel",
                    "mode": 0,
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 122.0, 2868.0, 2390.2619059085846, 245.0 ],
                    "proportion": 0.5
                }
            },
            {
                "box": {
                    "angle": 270.0,
                    "background": 1,
                    "bgcolor": [ 0.0, 0.22, 0.1, 0.0 ],
                    "border": 2,
                    "bordercolor": [ 1.0, 1.0, 1.0, 1.0 ],
                    "id": "pnl_stereo",
                    "maxclass": "panel",
                    "mode": 0,
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 122.0, 3130.0, 2391.0, 309.5 ],
                    "proportion": 0.5
                }
            },
            {
                "box": {
                    "angle": 270.0,
                    "background": 1,
                    "bgcolor": [ 0.0, 0.18, 0.22, 0.0 ],
                    "border": 2,
                    "bordercolor": [ 1.0, 1.0, 1.0, 1.0 ],
                    "id": "pnl_4ch",
                    "maxclass": "panel",
                    "mode": 0,
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 122.0, 3454.0, 2391.8182530999184, 246.90909826755524 ],
                    "proportion": 0.5
                }
            },
            {
                "box": {
                    "angle": 270.0,
                    "background": 1,
                    "bgcolor": [ 0.28, 0.17, 0.0, 0.0 ],
                    "border": 2,
                    "bordercolor": [ 1.0, 1.0, 1.0, 1.0 ],
                    "id": "obj-20",
                    "maxclass": "panel",
                    "mode": 0,
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [ 122.0, 1194.0, 2391.0446906089783, 864.1790735721588 ],
                    "proportion": 0.5
                }
            }
        ],
        "lines": [
            {
                "patchline": {
                    "destination": [ "obj-110", 0 ],
                    "order": 1,
                    "source": [ "obj-100", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-426", 0 ],
                    "order": 0,
                    "source": [ "obj-100", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9961", 0 ],
                    "source": [ "obj-10000", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9961", 0 ],
                    "source": [ "obj-10001", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9961", 0 ],
                    "source": [ "obj-10002", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9961", 0 ],
                    "source": [ "obj-10003", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9961", 0 ],
                    "source": [ "obj-10004", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9961", 0 ],
                    "source": [ "obj-10005", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9961", 0 ],
                    "source": [ "obj-10006", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9961", 0 ],
                    "source": [ "obj-10007", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9961", 0 ],
                    "source": [ "obj-10008", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-10017", 0 ],
                    "source": [ "obj-10013", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-10018", 0 ],
                    "source": [ "obj-10014", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-10019", 0 ],
                    "source": [ "obj-10015", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-10020", 0 ],
                    "source": [ "obj-10016", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9961", 0 ],
                    "source": [ "obj-10017", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9961", 0 ],
                    "source": [ "obj-10018", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9961", 0 ],
                    "source": [ "obj-10019", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9961", 0 ],
                    "source": [ "obj-10020", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-94", 0 ],
                    "source": [ "obj-101", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-94", 0 ],
                    "source": [ "obj-102", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-436", 0 ],
                    "order": 0,
                    "source": [ "obj-105", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-98", 0 ],
                    "order": 1,
                    "source": [ "obj-105", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-104", 0 ],
                    "source": [ "obj-106", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-104", 0 ],
                    "source": [ "obj-107", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-105", 0 ],
                    "source": [ "obj-109", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-15", 0 ],
                    "source": [ "obj-11", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230060", 0 ],
                    "source": [ "obj-111", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-113", 0 ],
                    "source": [ "obj-112", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-551", 0 ],
                    "source": [ "obj-113", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-127", 0 ],
                    "source": [ "obj-115", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-119", 0 ],
                    "source": [ "obj-116", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-120", 0 ],
                    "source": [ "obj-116", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-127", 0 ],
                    "source": [ "obj-117", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-69", 0 ],
                    "source": [ "obj-118", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-114", 0 ],
                    "source": [ "obj-119", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-114", 0 ],
                    "source": [ "obj-120", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-116", 0 ],
                    "order": 1,
                    "source": [ "obj-121", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-336", 0 ],
                    "order": 0,
                    "source": [ "obj-121", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-121", 0 ],
                    "source": [ "obj-122", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-125", 0 ],
                    "source": [ "obj-124", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-126", 0 ],
                    "source": [ "obj-124", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-123", 0 ],
                    "source": [ "obj-125", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-123", 0 ],
                    "source": [ "obj-126", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-18", 0 ],
                    "order": 1,
                    "source": [ "obj-13", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-8", 0 ],
                    "order": 2,
                    "source": [ "obj-13", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9922", 0 ],
                    "order": 0,
                    "source": [ "obj-13", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230016", 0 ],
                    "source": [ "obj-132", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-327", 0 ],
                    "order": 1,
                    "source": [ "obj-132", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-364", 0 ],
                    "order": 0,
                    "source": [ "obj-132", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230016", 0 ],
                    "source": [ "obj-133", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-270", 0 ],
                    "order": 1,
                    "source": [ "obj-133", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-325", 0 ],
                    "order": 0,
                    "source": [ "obj-133", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230016", 0 ],
                    "source": [ "obj-134", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-275", 0 ],
                    "order": 2,
                    "source": [ "obj-134", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-281", 0 ],
                    "order": 0,
                    "source": [ "obj-134", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-299", 0 ],
                    "order": 1,
                    "source": [ "obj-134", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230016", 0 ],
                    "source": [ "obj-135", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-341", 0 ],
                    "order": 1,
                    "source": [ "obj-135", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-347", 0 ],
                    "order": 0,
                    "source": [ "obj-135", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-500", 0 ],
                    "source": [ "obj-136", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-141", 0 ],
                    "source": [ "obj-138", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-141", 0 ],
                    "source": [ "obj-139", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-15", 0 ],
                    "source": [ "obj-14", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-143", 0 ],
                    "source": [ "obj-140", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-142", 0 ],
                    "source": [ "obj-143", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-147", 0 ],
                    "source": [ "obj-144", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-147", 0 ],
                    "source": [ "obj-145", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-149", 0 ],
                    "source": [ "obj-146", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-148", 0 ],
                    "source": [ "obj-149", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-27", 0 ],
                    "source": [ "obj-15", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-153", 0 ],
                    "source": [ "obj-150", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-153", 0 ],
                    "source": [ "obj-151", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-155", 0 ],
                    "source": [ "obj-152", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-154", 0 ],
                    "source": [ "obj-155", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-124", 0 ],
                    "order": 1,
                    "source": [ "obj-156", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-236", 0 ],
                    "order": 0,
                    "source": [ "obj-156", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-156", 0 ],
                    "source": [ "obj-158", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-21032", 0 ],
                    "source": [ "obj-159", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-5", 0 ],
                    "order": 1,
                    "source": [ "obj-16", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9920", 0 ],
                    "order": 0,
                    "source": [ "obj-16", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-21032", 1 ],
                    "source": [ "obj-160", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-770", 0 ],
                    "source": [ "obj-163", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-770", 0 ],
                    "source": [ "obj-164", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-770", 0 ],
                    "source": [ "obj-165", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-26", 0 ],
                    "source": [ "obj-17", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-170", 0 ],
                    "source": [ "obj-171", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-163", 0 ],
                    "order": 0,
                    "source": [ "obj-172", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-165", 1 ],
                    "source": [ "obj-172", 2 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-165", 0 ],
                    "source": [ "obj-172", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-187", 0 ],
                    "order": 1,
                    "source": [ "obj-172", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-175", 0 ],
                    "source": [ "obj-176", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-171", 0 ],
                    "midpoints": [ 4544.606350541115, 1961.9259594678879, 4775.457412719727, 1961.9259594678879 ],
                    "order": 0,
                    "source": [ "obj-177", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-176", 0 ],
                    "order": 1,
                    "source": [ "obj-177", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-177", 0 ],
                    "midpoints": [ 4544.606350541115, 1898.9259594678879, 4544.606350541115, 1898.9259594678879 ],
                    "source": [ "obj-179", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-179", 0 ],
                    "source": [ "obj-181", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-23", 0 ],
                    "source": [ "obj-187", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-233", 0 ],
                    "source": [ "obj-189", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-234", 0 ],
                    "source": [ "obj-192", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-202", 0 ],
                    "order": 0,
                    "source": [ "obj-200", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-210", 0 ],
                    "order": 1,
                    "source": [ "obj-200", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20009", 0 ],
                    "source": [ "obj-20008", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20011", 0 ],
                    "order": 0,
                    "source": [ "obj-20009", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20012", 1 ],
                    "order": 1,
                    "source": [ "obj-20009", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20009", 1 ],
                    "source": [ "obj-20010", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20013", 1 ],
                    "source": [ "obj-20011", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20014", 0 ],
                    "source": [ "obj-20012", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20015", 0 ],
                    "source": [ "obj-20013", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_LR_L_vocals", 0 ],
                    "source": [ "obj-20014", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_LR_R_vocals", 0 ],
                    "source": [ "obj-20015", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20019", 0 ],
                    "source": [ "obj-20018", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20021", 0 ],
                    "order": 0,
                    "source": [ "obj-20019", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20022", 1 ],
                    "order": 1,
                    "source": [ "obj-20019", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20019", 1 ],
                    "source": [ "obj-20020", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20023", 1 ],
                    "source": [ "obj-20021", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20024", 0 ],
                    "source": [ "obj-20022", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20025", 0 ],
                    "source": [ "obj-20023", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_LR_L_drums", 0 ],
                    "source": [ "obj-20024", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_LR_R_drums", 0 ],
                    "source": [ "obj-20025", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20029", 0 ],
                    "source": [ "obj-20028", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20031", 0 ],
                    "order": 0,
                    "source": [ "obj-20029", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20032", 1 ],
                    "order": 1,
                    "source": [ "obj-20029", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20029", 1 ],
                    "source": [ "obj-20030", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20033", 1 ],
                    "source": [ "obj-20031", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20034", 0 ],
                    "source": [ "obj-20032", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20035", 0 ],
                    "source": [ "obj-20033", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_LR_L_bass", 0 ],
                    "source": [ "obj-20034", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_LR_R_bass", 0 ],
                    "source": [ "obj-20035", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20039", 0 ],
                    "source": [ "obj-20038", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20041", 0 ],
                    "order": 0,
                    "source": [ "obj-20039", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20042", 1 ],
                    "order": 1,
                    "source": [ "obj-20039", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20039", 1 ],
                    "source": [ "obj-20040", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20043", 1 ],
                    "source": [ "obj-20041", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20044", 0 ],
                    "source": [ "obj-20042", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20045", 0 ],
                    "source": [ "obj-20043", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_LR_L_melody", 0 ],
                    "source": [ "obj-20044", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_LR_R_melody", 0 ],
                    "source": [ "obj-20045", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20101", 0 ],
                    "source": [ "obj-20100", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20102", 0 ],
                    "source": [ "obj-20101", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20105", 0 ],
                    "source": [ "obj-20101", 3 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20108", 0 ],
                    "source": [ "obj-20101", 6 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20111", 0 ],
                    "source": [ "obj-20101", 9 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230034", 0 ],
                    "source": [ "obj-20101", 17 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230040", 0 ],
                    "source": [ "obj-20101", 18 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230046", 0 ],
                    "source": [ "obj-20101", 19 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230052", 0 ],
                    "source": [ "obj-20101", 20 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-23024", 0 ],
                    "source": [ "obj-20101", 12 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-23025", 0 ],
                    "source": [ "obj-20101", 13 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-23026", 0 ],
                    "source": [ "obj-20101", 14 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-23027", 0 ],
                    "source": [ "obj-20101", 15 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-23028", 0 ],
                    "source": [ "obj-20101", 16 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsend_joyX_bass", 0 ],
                    "source": [ "obj-20101", 46 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsend_joyX_drums", 0 ],
                    "source": [ "obj-20101", 44 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsend_joyX_melody", 0 ],
                    "source": [ "obj-20101", 48 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsend_joyX_vocals", 0 ],
                    "source": [ "obj-20101", 42 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsend_joyY_bass", 0 ],
                    "source": [ "obj-20101", 47 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsend_joyY_drums", 0 ],
                    "source": [ "obj-20101", 45 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsend_joyY_melody", 0 ],
                    "source": [ "obj-20101", 49 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsend_joyY_vocals", 0 ],
                    "source": [ "obj-20101", 43 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-snd_mpFront", 0 ],
                    "source": [ "obj-20101", 40 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-snd_mpRear", 0 ],
                    "source": [ "obj-20101", 41 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-232", 0 ],
                    "order": 1,
                    "source": [ "obj-202", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4017", 0 ],
                    "order": 0,
                    "source": [ "obj-202", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-198", 0 ],
                    "source": [ "obj-208", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-159", 0 ],
                    "order": 1,
                    "source": [ "obj-21070", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22064", 1 ],
                    "order": 2,
                    "source": [ "obj-21070", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-5003", 0 ],
                    "order": 0,
                    "source": [ "obj-21070", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-160", 0 ],
                    "order": 1,
                    "source": [ "obj-21071", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230068", 0 ],
                    "order": 0,
                    "source": [ "obj-21071", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-213", 0 ],
                    "source": [ "obj-212", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-551", 0 ],
                    "source": [ "obj-213", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-198", 0 ],
                    "source": [ "obj-216", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-208", 0 ],
                    "source": [ "obj-217", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-216", 0 ],
                    "source": [ "obj-217", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-222", 0 ],
                    "source": [ "obj-220", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-223", 0 ],
                    "source": [ "obj-220", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22001", 0 ],
                    "source": [ "obj-22000", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22002", 0 ],
                    "source": [ "obj-22001", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22003", 0 ],
                    "source": [ "obj-22001", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22004", 0 ],
                    "source": [ "obj-22001", 2 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22005", 0 ],
                    "source": [ "obj-22001", 3 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22006", 0 ],
                    "source": [ "obj-22001", 4 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22007", 0 ],
                    "source": [ "obj-22001", 5 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22008", 0 ],
                    "source": [ "obj-22001", 6 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22009", 0 ],
                    "source": [ "obj-22001", 7 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22010", 0 ],
                    "source": [ "obj-22001", 8 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22011", 0 ],
                    "source": [ "obj-22001", 9 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22012", 0 ],
                    "source": [ "obj-22001", 10 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22013", 0 ],
                    "source": [ "obj-22001", 11 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22014", 0 ],
                    "source": [ "obj-22001", 12 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22015", 0 ],
                    "source": [ "obj-22001", 13 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22016", 0 ],
                    "source": [ "obj-22001", 14 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22017", 0 ],
                    "source": [ "obj-22001", 15 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230019", 0 ],
                    "source": [ "obj-22001", 20 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230022", 0 ],
                    "source": [ "obj-22001", 21 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230025", 0 ],
                    "source": [ "obj-22001", 22 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230028", 0 ],
                    "source": [ "obj-22001", 23 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-23020", 0 ],
                    "source": [ "obj-22001", 16 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-23021", 0 ],
                    "source": [ "obj-22001", 17 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-23022", 0 ],
                    "source": [ "obj-22001", 18 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-23023", 0 ],
                    "source": [ "obj-22001", 19 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22020", 0 ],
                    "source": [ "obj-22018", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22018", 1 ],
                    "source": [ "obj-22019", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22023", 0 ],
                    "source": [ "obj-22020", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22022", 0 ],
                    "source": [ "obj-22021", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22020", 5 ],
                    "source": [ "obj-22022", 4 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22020", 4 ],
                    "source": [ "obj-22022", 3 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22020", 3 ],
                    "source": [ "obj-22022", 2 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22020", 2 ],
                    "source": [ "obj-22022", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22020", 1 ],
                    "source": [ "obj-22022", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22026", 0 ],
                    "source": [ "obj-22023", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22025", 0 ],
                    "source": [ "obj-22024", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22023", 5 ],
                    "source": [ "obj-22025", 4 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22023", 4 ],
                    "source": [ "obj-22025", 3 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22023", 3 ],
                    "source": [ "obj-22025", 2 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22023", 2 ],
                    "source": [ "obj-22025", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22023", 1 ],
                    "source": [ "obj-22025", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-711", 0 ],
                    "source": [ "obj-22026", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22028", 0 ],
                    "source": [ "obj-22027", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22026", 5 ],
                    "source": [ "obj-22028", 4 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22026", 4 ],
                    "source": [ "obj-22028", 3 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22026", 3 ],
                    "source": [ "obj-22028", 2 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22026", 2 ],
                    "source": [ "obj-22028", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22026", 1 ],
                    "source": [ "obj-22028", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22031", 0 ],
                    "source": [ "obj-22029", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22029", 1 ],
                    "source": [ "obj-22030", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22034", 0 ],
                    "source": [ "obj-22031", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22033", 0 ],
                    "source": [ "obj-22032", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22031", 5 ],
                    "source": [ "obj-22033", 4 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22031", 4 ],
                    "source": [ "obj-22033", 3 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22031", 3 ],
                    "source": [ "obj-22033", 2 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22031", 2 ],
                    "source": [ "obj-22033", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22031", 1 ],
                    "source": [ "obj-22033", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22037", 0 ],
                    "source": [ "obj-22034", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22036", 0 ],
                    "source": [ "obj-22035", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22034", 5 ],
                    "source": [ "obj-22036", 4 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22034", 4 ],
                    "source": [ "obj-22036", 3 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22034", 3 ],
                    "source": [ "obj-22036", 2 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22034", 2 ],
                    "source": [ "obj-22036", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22034", 1 ],
                    "source": [ "obj-22036", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-741", 0 ],
                    "source": [ "obj-22037", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22039", 0 ],
                    "source": [ "obj-22038", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22037", 5 ],
                    "source": [ "obj-22039", 4 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22037", 4 ],
                    "source": [ "obj-22039", 3 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22037", 3 ],
                    "source": [ "obj-22039", 2 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22037", 2 ],
                    "source": [ "obj-22039", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22037", 1 ],
                    "source": [ "obj-22039", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22042", 0 ],
                    "source": [ "obj-22040", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22040", 1 ],
                    "source": [ "obj-22041", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22045", 0 ],
                    "source": [ "obj-22042", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22044", 0 ],
                    "source": [ "obj-22043", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22042", 5 ],
                    "source": [ "obj-22044", 4 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22042", 4 ],
                    "source": [ "obj-22044", 3 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22042", 3 ],
                    "source": [ "obj-22044", 2 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22042", 2 ],
                    "source": [ "obj-22044", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22042", 1 ],
                    "source": [ "obj-22044", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22048", 0 ],
                    "source": [ "obj-22045", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22047", 0 ],
                    "source": [ "obj-22046", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22045", 5 ],
                    "source": [ "obj-22047", 4 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22045", 4 ],
                    "source": [ "obj-22047", 3 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22045", 3 ],
                    "source": [ "obj-22047", 2 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22045", 2 ],
                    "source": [ "obj-22047", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22045", 1 ],
                    "source": [ "obj-22047", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-771", 0 ],
                    "source": [ "obj-22048", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22050", 0 ],
                    "source": [ "obj-22049", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22048", 5 ],
                    "source": [ "obj-22050", 4 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22048", 4 ],
                    "source": [ "obj-22050", 3 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22048", 3 ],
                    "source": [ "obj-22050", 2 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22048", 2 ],
                    "source": [ "obj-22050", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22048", 1 ],
                    "source": [ "obj-22050", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22053", 0 ],
                    "source": [ "obj-22051", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22051", 1 ],
                    "source": [ "obj-22052", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22056", 0 ],
                    "source": [ "obj-22053", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22055", 0 ],
                    "source": [ "obj-22054", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22053", 5 ],
                    "source": [ "obj-22055", 4 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22053", 4 ],
                    "source": [ "obj-22055", 3 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22053", 3 ],
                    "source": [ "obj-22055", 2 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22053", 2 ],
                    "source": [ "obj-22055", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22053", 1 ],
                    "source": [ "obj-22055", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22059", 0 ],
                    "source": [ "obj-22056", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22058", 0 ],
                    "source": [ "obj-22057", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22056", 5 ],
                    "source": [ "obj-22058", 4 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22056", 4 ],
                    "source": [ "obj-22058", 3 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22056", 3 ],
                    "source": [ "obj-22058", 2 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22056", 2 ],
                    "source": [ "obj-22058", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22056", 1 ],
                    "source": [ "obj-22058", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-801", 0 ],
                    "source": [ "obj-22059", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22061", 0 ],
                    "source": [ "obj-22060", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22059", 5 ],
                    "source": [ "obj-22061", 4 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22059", 4 ],
                    "source": [ "obj-22061", 3 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22059", 3 ],
                    "source": [ "obj-22061", 2 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22059", 2 ],
                    "source": [ "obj-22061", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22059", 1 ],
                    "source": [ "obj-22061", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22063", 0 ],
                    "source": [ "obj-22062", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22000", 0 ],
                    "source": [ "obj-22063", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22064", 0 ],
                    "source": [ "obj-22065", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-225", 0 ],
                    "source": [ "obj-222", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-225", 0 ],
                    "source": [ "obj-223", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-332", 0 ],
                    "order": 1,
                    "source": [ "obj-226", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4010", 0 ],
                    "order": 0,
                    "source": [ "obj-226", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-238", 0 ],
                    "source": [ "obj-227", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-551", 0 ],
                    "source": [ "obj-23", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-229", 0 ],
                    "source": [ "obj-230", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-23001", 1 ],
                    "source": [ "obj-23000", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230018", 0 ],
                    "source": [ "obj-23001", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230011", 1 ],
                    "source": [ "obj-230010", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230035", 1 ],
                    "order": 0,
                    "source": [ "obj-230011", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230035", 0 ],
                    "order": 1,
                    "source": [ "obj-230011", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230013", 1 ],
                    "source": [ "obj-230012", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230041", 1 ],
                    "order": 0,
                    "source": [ "obj-230013", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230041", 0 ],
                    "order": 1,
                    "source": [ "obj-230013", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230015", 1 ],
                    "source": [ "obj-230014", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230047", 1 ],
                    "order": 0,
                    "source": [ "obj-230015", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230047", 0 ],
                    "order": 1,
                    "source": [ "obj-230015", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230018", 1 ],
                    "source": [ "obj-230017", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20008", 0 ],
                    "order": 3,
                    "source": [ "obj-230018", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20012", 0 ],
                    "order": 2,
                    "source": [ "obj-230018", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20013", 0 ],
                    "order": 1,
                    "source": [ "obj-230018", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-23009", 0 ],
                    "order": 0,
                    "source": [ "obj-230018", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-6001", 0 ],
                    "order": 4,
                    "source": [ "obj-230018", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-23003", 1 ],
                    "source": [ "obj-23002", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230021", 1 ],
                    "source": [ "obj-230020", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20018", 0 ],
                    "order": 3,
                    "source": [ "obj-230021", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20022", 0 ],
                    "order": 2,
                    "source": [ "obj-230021", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20023", 0 ],
                    "order": 1,
                    "source": [ "obj-230021", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230011", 0 ],
                    "order": 0,
                    "source": [ "obj-230021", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-6002", 0 ],
                    "order": 4,
                    "source": [ "obj-230021", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230024", 1 ],
                    "source": [ "obj-230023", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20028", 0 ],
                    "order": 3,
                    "source": [ "obj-230024", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20032", 0 ],
                    "order": 2,
                    "source": [ "obj-230024", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20033", 0 ],
                    "order": 1,
                    "source": [ "obj-230024", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230013", 0 ],
                    "order": 0,
                    "source": [ "obj-230024", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230027", 1 ],
                    "source": [ "obj-230026", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20038", 0 ],
                    "order": 3,
                    "source": [ "obj-230027", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20042", 0 ],
                    "order": 2,
                    "source": [ "obj-230027", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20043", 0 ],
                    "order": 1,
                    "source": [ "obj-230027", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230015", 0 ],
                    "order": 0,
                    "source": [ "obj-230027", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230021", 0 ],
                    "source": [ "obj-23003", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-fxret_gL_vocals", 0 ],
                    "source": [ "obj-230030", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-fxret_gR_vocals", 0 ],
                    "source": [ "obj-230030", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-fxret_gL_drums", 0 ],
                    "source": [ "obj-230036", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-fxret_gR_drums", 0 ],
                    "source": [ "obj-230036", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-23005", 1 ],
                    "source": [ "obj-23004", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-fxret_gL_bass", 0 ],
                    "source": [ "obj-230042", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-fxret_gR_bass", 0 ],
                    "source": [ "obj-230042", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-fxret_gL_melody", 0 ],
                    "source": [ "obj-230048", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-fxret_gR_melody", 0 ],
                    "source": [ "obj-230048", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230024", 0 ],
                    "source": [ "obj-23005", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-23007", 1 ],
                    "source": [ "obj-23006", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-5006", 1 ],
                    "source": [ "obj-230068", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230027", 0 ],
                    "source": [ "obj-23007", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-23009", 1 ],
                    "source": [ "obj-23008", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230029", 1 ],
                    "order": 0,
                    "source": [ "obj-23009", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230029", 0 ],
                    "order": 1,
                    "source": [ "obj-23009", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-21070", 1 ],
                    "order": 1,
                    "source": [ "obj-23019", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-21071", 1 ],
                    "order": 0,
                    "source": [ "obj-23019", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-189", 0 ],
                    "order": 1,
                    "source": [ "obj-232", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230016", 0 ],
                    "source": [ "obj-232", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-435", 0 ],
                    "order": 0,
                    "source": [ "obj-232", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-192", 0 ],
                    "order": 1,
                    "source": [ "obj-233", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230016", 0 ],
                    "source": [ "obj-233", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-321", 0 ],
                    "order": 0,
                    "source": [ "obj-233", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-181", 0 ],
                    "order": 0,
                    "source": [ "obj-234", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-217", 0 ],
                    "order": 1,
                    "source": [ "obj-234", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230016", 0 ],
                    "source": [ "obj-234", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-316", 0 ],
                    "order": 2,
                    "source": [ "obj-234", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-500", 0 ],
                    "source": [ "obj-236", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230", 0 ],
                    "source": [ "obj-237", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-237", 0 ],
                    "midpoints": [ 3887.1595467329025, 1900.0918229818344, 3887.1595467329025, 1900.0918229818344 ],
                    "source": [ "obj-238", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-334", 0 ],
                    "source": [ "obj-243", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-28", 0 ],
                    "order": 1,
                    "source": [ "obj-25", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-37", 1 ],
                    "source": [ "obj-25", 2 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-37", 0 ],
                    "source": [ "obj-25", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-44", 0 ],
                    "order": 0,
                    "source": [ "obj-25", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-333", 0 ],
                    "source": [ "obj-250", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4003", 0 ],
                    "order": 0,
                    "source": [ "obj-253", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-432", 0 ],
                    "order": 1,
                    "source": [ "obj-253", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-434", 0 ],
                    "source": [ "obj-254", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-263", 0 ],
                    "source": [ "obj-258", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4030", 0 ],
                    "source": [ "obj-26", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-260", 0 ],
                    "source": [ "obj-261", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-261", 0 ],
                    "source": [ "obj-262", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-262", 0 ],
                    "midpoints": [ 3206.3084877729416, 1896.8584687113762, 3206.3084877729416, 1896.8584687113762 ],
                    "source": [ "obj-263", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-265", 0 ],
                    "source": [ "obj-264", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-266", 0 ],
                    "source": [ "obj-264", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-269", 0 ],
                    "source": [ "obj-265", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-269", 0 ],
                    "source": [ "obj-266", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-30", 0 ],
                    "source": [ "obj-27", 2 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-134", 0 ],
                    "source": [ "obj-270", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-433", 0 ],
                    "source": [ "obj-271", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-280", 0 ],
                    "source": [ "obj-275", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-277", 0 ],
                    "source": [ "obj-278", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-278", 0 ],
                    "source": [ "obj-279", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-709", 0 ],
                    "source": [ "obj-28", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-279", 0 ],
                    "midpoints": [ 2579.7127475738525, 1894.4901871085167, 2579.7127475738525, 1894.4901871085167 ],
                    "source": [ "obj-280", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-283", 0 ],
                    "source": [ "obj-281", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-284", 0 ],
                    "source": [ "obj-281", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-286", 0 ],
                    "source": [ "obj-283", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-286", 0 ],
                    "source": [ "obj-284", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-135", 0 ],
                    "source": [ "obj-299", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4002", 0 ],
                    "source": [ "obj-30", 2 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-226", 0 ],
                    "order": 0,
                    "source": [ "obj-300", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-310", 0 ],
                    "order": 1,
                    "source": [ "obj-300", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-297", 0 ],
                    "source": [ "obj-301", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-304", 0 ],
                    "source": [ "obj-302", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-305", 0 ],
                    "source": [ "obj-303", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230016", 0 ],
                    "source": [ "obj-305", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-339", 0 ],
                    "order": 1,
                    "source": [ "obj-305", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4009", 0 ],
                    "order": 0,
                    "source": [ "obj-305", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-308", 0 ],
                    "source": [ "obj-306", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-309", 0 ],
                    "source": [ "obj-307", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230016", 0 ],
                    "source": [ "obj-309", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-335", 0 ],
                    "order": 1,
                    "source": [ "obj-309", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4016", 0 ],
                    "order": 0,
                    "source": [ "obj-309", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-313", 0 ],
                    "source": [ "obj-312", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-551", 0 ],
                    "source": [ "obj-313", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-317", 0 ],
                    "source": [ "obj-315", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-318", 0 ],
                    "source": [ "obj-316", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230016", 0 ],
                    "source": [ "obj-318", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-330", 0 ],
                    "order": 1,
                    "source": [ "obj-318", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4023", 0 ],
                    "order": 0,
                    "source": [ "obj-318", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-150", 0 ],
                    "source": [ "obj-321", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-151", 0 ],
                    "source": [ "obj-321", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-144", 0 ],
                    "source": [ "obj-322", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-145", 0 ],
                    "source": [ "obj-322", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-138", 0 ],
                    "source": [ "obj-323", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-139", 0 ],
                    "source": [ "obj-323", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-115", 0 ],
                    "source": [ "obj-325", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-117", 0 ],
                    "source": [ "obj-325", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-133", 0 ],
                    "source": [ "obj-327", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-317", 0 ],
                    "source": [ "obj-329", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-16", 3 ],
                    "source": [ "obj-33", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-315", 0 ],
                    "source": [ "obj-330", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-329", 0 ],
                    "source": [ "obj-330", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230016", 0 ],
                    "source": [ "obj-332", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-250", 0 ],
                    "order": 1,
                    "source": [ "obj-332", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-430", 0 ],
                    "order": 0,
                    "source": [ "obj-332", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230016", 0 ],
                    "source": [ "obj-333", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-243", 0 ],
                    "order": 1,
                    "source": [ "obj-333", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-322", 0 ],
                    "order": 0,
                    "source": [ "obj-333", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-220", 0 ],
                    "order": 2,
                    "source": [ "obj-334", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-227", 0 ],
                    "order": 1,
                    "source": [ "obj-334", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230016", 0 ],
                    "source": [ "obj-334", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-307", 0 ],
                    "order": 0,
                    "source": [ "obj-334", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-306", 0 ],
                    "source": [ "obj-335", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-337", 0 ],
                    "source": [ "obj-335", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-500", 0 ],
                    "source": [ "obj-336", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-308", 0 ],
                    "source": [ "obj-337", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-304", 0 ],
                    "source": [ "obj-338", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-302", 0 ],
                    "source": [ "obj-339", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-338", 0 ],
                    "source": [ "obj-339", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-297", 0 ],
                    "source": [ "obj-340", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-301", 0 ],
                    "source": [ "obj-341", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-340", 0 ],
                    "source": [ "obj-341", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-356", 0 ],
                    "order": 1,
                    "source": [ "obj-346", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-85", 0 ],
                    "order": 0,
                    "source": [ "obj-346", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-346", 0 ],
                    "source": [ "obj-347", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-84", 0 ],
                    "source": [ "obj-350", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-350", 0 ],
                    "source": [ "obj-351", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-352", 0 ],
                    "source": [ "obj-353", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-352", 0 ],
                    "source": [ "obj-355", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-353", 0 ],
                    "source": [ "obj-356", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-355", 0 ],
                    "source": [ "obj-356", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-33", 1 ],
                    "source": [ "obj-36", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-70", 0 ],
                    "source": [ "obj-364", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-71", 0 ],
                    "source": [ "obj-364", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-372", 0 ],
                    "source": [ "obj-369", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-710", 0 ],
                    "source": [ "obj-37", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4007", 0 ],
                    "source": [ "obj-371", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4008", 0 ],
                    "source": [ "obj-371", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-385", 0 ],
                    "source": [ "obj-372", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-36", 0 ],
                    "source": [ "obj-38", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4014", 0 ],
                    "source": [ "obj-386", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4015", 0 ],
                    "source": [ "obj-386", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-389", 0 ],
                    "source": [ "obj-387", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-404", 0 ],
                    "source": [ "obj-389", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-33", 1 ],
                    "source": [ "obj-39", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-41", 1 ],
                    "source": [ "obj-4", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-41", 0 ],
                    "source": [ "obj-4", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-253", 0 ],
                    "order": 1,
                    "source": [ "obj-400", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-410", 0 ],
                    "order": 0,
                    "source": [ "obj-400", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-500", 0 ],
                    "source": [ "obj-4002", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-109", 0 ],
                    "order": 1,
                    "source": [ "obj-4006", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-371", 0 ],
                    "order": 0,
                    "source": [ "obj-4006", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-370", 0 ],
                    "source": [ "obj-4007", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-370", 0 ],
                    "source": [ "obj-4008", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4006", 0 ],
                    "source": [ "obj-4009", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-122", 0 ],
                    "order": 1,
                    "source": [ "obj-4013", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-386", 0 ],
                    "order": 0,
                    "source": [ "obj-4013", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-388", 0 ],
                    "source": [ "obj-4014", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-388", 0 ],
                    "source": [ "obj-4015", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4013", 0 ],
                    "source": [ "obj-4016", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-158", 0 ],
                    "order": 0,
                    "source": [ "obj-4020", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-425", 0 ],
                    "order": 1,
                    "source": [ "obj-4020", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-406", 0 ],
                    "source": [ "obj-4021", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-406", 0 ],
                    "source": [ "obj-4022", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4020", 0 ],
                    "source": [ "obj-4023", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-20100", 0 ],
                    "order": 0,
                    "source": [ "obj-4030", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22000", 0 ],
                    "order": 1,
                    "source": [ "obj-4030", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4031", 0 ],
                    "source": [ "obj-4030", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4041", 0 ],
                    "order": 2,
                    "source": [ "obj-4030", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-5011", 0 ],
                    "order": 3,
                    "source": [ "obj-4030", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-7014", 0 ],
                    "order": 4,
                    "source": [ "obj-4030", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9961", 0 ],
                    "order": 5,
                    "source": [ "obj-4030", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4039", 0 ],
                    "source": [ "obj-4038", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4030", 0 ],
                    "source": [ "obj-4039", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4042", 0 ],
                    "source": [ "obj-4041", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4043", 0 ],
                    "source": [ "obj-4041", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4044", 0 ],
                    "source": [ "obj-4041", 2 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4045", 0 ],
                    "source": [ "obj-4041", 3 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4046", 0 ],
                    "source": [ "obj-4041", 4 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4047", 0 ],
                    "source": [ "obj-4041", 5 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4048", 0 ],
                    "source": [ "obj-4041", 6 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4049", 0 ],
                    "source": [ "obj-4041", 7 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4050", 0 ],
                    "source": [ "obj-4041", 8 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4051", 0 ],
                    "source": [ "obj-4041", 9 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4052", 0 ],
                    "source": [ "obj-4041", 10 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4053", 0 ],
                    "source": [ "obj-4041", 11 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4054", 0 ],
                    "source": [ "obj-4041", 12 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4055", 0 ],
                    "source": [ "obj-4041", 13 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4056", 0 ],
                    "source": [ "obj-4041", 14 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4057", 0 ],
                    "source": [ "obj-4041", 15 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4058", 0 ],
                    "source": [ "obj-4041", 16 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4059", 0 ],
                    "source": [ "obj-4041", 17 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4060", 0 ],
                    "source": [ "obj-4041", 18 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4061", 0 ],
                    "source": [ "obj-4041", 19 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4066", 0 ],
                    "source": [ "obj-4041", 20 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4067", 0 ],
                    "source": [ "obj-4041", 21 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4068", 0 ],
                    "source": [ "obj-4041", 22 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4069", 0 ],
                    "source": [ "obj-4041", 23 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-551", 0 ],
                    "source": [ "obj-4041", 24 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-551", 0 ],
                    "source": [ "obj-4042", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-551", 0 ],
                    "source": [ "obj-4043", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-551", 0 ],
                    "source": [ "obj-4044", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-551", 0 ],
                    "source": [ "obj-4045", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-551", 0 ],
                    "source": [ "obj-4046", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-551", 0 ],
                    "source": [ "obj-4047", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-551", 0 ],
                    "source": [ "obj-4048", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-551", 0 ],
                    "source": [ "obj-4049", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-424", 0 ],
                    "source": [ "obj-405", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-551", 0 ],
                    "source": [ "obj-4050", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-551", 0 ],
                    "source": [ "obj-4051", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-551", 0 ],
                    "source": [ "obj-4052", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-551", 0 ],
                    "source": [ "obj-4053", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-551", 0 ],
                    "source": [ "obj-4054", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-551", 0 ],
                    "source": [ "obj-4055", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-551", 0 ],
                    "source": [ "obj-4056", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-551", 0 ],
                    "source": [ "obj-4057", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-551", 0 ],
                    "source": [ "obj-4058", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-551", 0 ],
                    "source": [ "obj-4059", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-551", 0 ],
                    "source": [ "obj-4060", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-551", 0 ],
                    "source": [ "obj-4061", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4065", 0 ],
                    "source": [ "obj-4064", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9974", 0 ],
                    "source": [ "obj-4065", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9975", 0 ],
                    "source": [ "obj-4065", 3 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9976", 0 ],
                    "source": [ "obj-4065", 2 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9977", 0 ],
                    "source": [ "obj-4065", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-551", 0 ],
                    "source": [ "obj-4066", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-500", 0 ],
                    "order": 1,
                    "source": [ "obj-4067", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-501", 0 ],
                    "order": 0,
                    "source": [ "obj-4067", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9982", 0 ],
                    "source": [ "obj-4068", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-551", 0 ],
                    "source": [ "obj-4069", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-39", 0 ],
                    "source": [ "obj-41", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-413", 0 ],
                    "source": [ "obj-412", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-551", 0 ],
                    "source": [ "obj-413", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-423", 0 ],
                    "source": [ "obj-424", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4021", 0 ],
                    "source": [ "obj-425", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4022", 0 ],
                    "source": [ "obj-425", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-132", 0 ],
                    "order": 1,
                    "source": [ "obj-426", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-357", 0 ],
                    "order": 0,
                    "source": [ "obj-426", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-106", 0 ],
                    "source": [ "obj-429", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-107", 0 ],
                    "source": [ "obj-429", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-710", 0 ],
                    "source": [ "obj-43", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-96", 0 ],
                    "source": [ "obj-430", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-97", 0 ],
                    "source": [ "obj-430", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230016", 0 ],
                    "source": [ "obj-432", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-271", 0 ],
                    "order": 1,
                    "source": [ "obj-432", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-429", 0 ],
                    "order": 0,
                    "source": [ "obj-432", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230016", 0 ],
                    "source": [ "obj-433", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-254", 0 ],
                    "order": 1,
                    "source": [ "obj-433", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-323", 0 ],
                    "order": 0,
                    "source": [ "obj-433", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230016", 0 ],
                    "source": [ "obj-434", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-258", 0 ],
                    "order": 1,
                    "source": [ "obj-434", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-264", 0 ],
                    "order": 0,
                    "source": [ "obj-434", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-303", 0 ],
                    "order": 2,
                    "source": [ "obj-434", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-89", 0 ],
                    "source": [ "obj-435", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-90", 0 ],
                    "source": [ "obj-435", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-500", 0 ],
                    "source": [ "obj-436", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4038", 0 ],
                    "order": 0,
                    "source": [ "obj-437", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9902", 0 ],
                    "order": 1,
                    "source": [ "obj-437", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-710", 0 ],
                    "source": [ "obj-44", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-15", 0 ],
                    "source": [ "obj-5", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-41", 0 ],
                    "source": [ "obj-50", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-100", 0 ],
                    "order": 1,
                    "source": [ "obj-500", 5 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-16", 0 ],
                    "source": [ "obj-500", 2 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-200", 0 ],
                    "order": 1,
                    "source": [ "obj-500", 8 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-245", 1 ],
                    "order": 0,
                    "source": [ "obj-500", 7 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-247", 1 ],
                    "order": 0,
                    "source": [ "obj-500", 8 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-248", 1 ],
                    "order": 0,
                    "source": [ "obj-500", 6 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-249", 1 ],
                    "order": 0,
                    "source": [ "obj-500", 5 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-300", 0 ],
                    "order": 1,
                    "source": [ "obj-500", 7 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4", 0 ],
                    "source": [ "obj-500", 3 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-400", 0 ],
                    "order": 1,
                    "source": [ "obj-500", 6 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-501", 0 ],
                    "source": [ "obj-500", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-6001", 0 ],
                    "source": [ "obj-500", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-5001", 0 ],
                    "source": [ "obj-5000", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-5002", 0 ],
                    "source": [ "obj-5001", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-7005", 0 ],
                    "source": [ "obj-5002", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-5005", 1 ],
                    "source": [ "obj-5003", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-5005", 0 ],
                    "order": 1,
                    "source": [ "obj-5004", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-5006", 0 ],
                    "order": 0,
                    "source": [ "obj-5004", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-5007", 1 ],
                    "source": [ "obj-5005", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-5007", 0 ],
                    "source": [ "obj-5006", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-5008", 0 ],
                    "source": [ "obj-5007", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-7013", 1 ],
                    "source": [ "obj-5008", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9903", 0 ],
                    "source": [ "obj-501", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-5004", 0 ],
                    "source": [ "obj-5011", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22018", 0 ],
                    "order": 1,
                    "source": [ "obj-5100", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-5000", 0 ],
                    "order": 0,
                    "source": [ "obj-5100", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22029", 0 ],
                    "order": 1,
                    "source": [ "obj-5101", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-5000", 1 ],
                    "order": 0,
                    "source": [ "obj-5101", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22040", 0 ],
                    "order": 1,
                    "source": [ "obj-5102", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-5001", 1 ],
                    "order": 0,
                    "source": [ "obj-5102", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22051", 0 ],
                    "order": 0,
                    "source": [ "obj-5103", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-5002", 1 ],
                    "order": 1,
                    "source": [ "obj-5103", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-739", 0 ],
                    "source": [ "obj-53", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-53", 0 ],
                    "order": 1,
                    "source": [ "obj-54", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-55", 0 ],
                    "order": 0,
                    "source": [ "obj-54", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-57", 1 ],
                    "source": [ "obj-54", 2 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-57", 0 ],
                    "source": [ "obj-54", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-740", 0 ],
                    "source": [ "obj-55", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4030", 0 ],
                    "order": 0,
                    "source": [ "obj-551", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4064", 0 ],
                    "order": 1,
                    "source": [ "obj-551", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9961", 0 ],
                    "order": 2,
                    "source": [ "obj-551", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9961", 0 ],
                    "source": [ "obj-551", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-740", 0 ],
                    "source": [ "obj-56", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-740", 0 ],
                    "source": [ "obj-57", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-800", 0 ],
                    "source": [ "obj-58", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-800", 0 ],
                    "source": [ "obj-59", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-800", 0 ],
                    "source": [ "obj-60", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-6002", 0 ],
                    "source": [ "obj-6001", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-7013", 1 ],
                    "source": [ "obj-6002", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-58", 0 ],
                    "order": 1,
                    "source": [ "obj-61", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-60", 1 ],
                    "source": [ "obj-61", 2 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-60", 0 ],
                    "source": [ "obj-61", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-63", 0 ],
                    "order": 0,
                    "source": [ "obj-61", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-799", 0 ],
                    "source": [ "obj-63", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230063", 0 ],
                    "source": [ "obj-65", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230062", 0 ],
                    "source": [ "obj-66", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-128", 0 ],
                    "source": [ "obj-69", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4039", 0 ],
                    "source": [ "obj-7", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22", 0 ],
                    "source": [ "obj-70", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-7012", 0 ],
                    "source": [ "obj-7005", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-7013", 1 ],
                    "source": [ "obj-7012", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-4030", 0 ],
                    "source": [ "obj-7013", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-7015", 0 ],
                    "source": [ "obj-7014", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-7013", 0 ],
                    "source": [ "obj-7015", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-551", 0 ],
                    "source": [ "obj-709", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-22", 0 ],
                    "source": [ "obj-71", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-5100", 0 ],
                    "source": [ "obj-710", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-23001", 0 ],
                    "source": [ "obj-711", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-551", 0 ],
                    "source": [ "obj-739", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-5101", 0 ],
                    "source": [ "obj-740", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-23003", 0 ],
                    "source": [ "obj-741", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-136", 0 ],
                    "order": 0,
                    "source": [ "obj-75", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-86", 0 ],
                    "order": 1,
                    "source": [ "obj-75", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-230061", 0 ],
                    "source": [ "obj-76", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-5102", 0 ],
                    "source": [ "obj-770", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-23005", 0 ],
                    "source": [ "obj-771", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-551", 0 ],
                    "source": [ "obj-799", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-14", 0 ],
                    "order": 1,
                    "source": [ "obj-8", 3 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-16", 0 ],
                    "source": [ "obj-8", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-33", 0 ],
                    "source": [ "obj-8", 2 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-41", 0 ],
                    "source": [ "obj-8", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9921", 0 ],
                    "order": 0,
                    "source": [ "obj-8", 3 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-5103", 0 ],
                    "source": [ "obj-800", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-23007", 0 ],
                    "source": [ "obj-801", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-75", 0 ],
                    "source": [ "obj-85", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-87", 0 ],
                    "source": [ "obj-86", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-91", 0 ],
                    "source": [ "obj-86", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-93", 0 ],
                    "source": [ "obj-87", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-88", 0 ],
                    "source": [ "obj-89", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-88", 0 ],
                    "source": [ "obj-90", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-93", 0 ],
                    "source": [ "obj-91", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-99", 0 ],
                    "source": [ "obj-96", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-99", 0 ],
                    "source": [ "obj-97", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-101", 0 ],
                    "source": [ "obj-98", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-102", 0 ],
                    "source": [ "obj-98", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9903", 0 ],
                    "source": [ "obj-9902", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9930", 0 ],
                    "source": [ "obj-9903", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9911", 0 ],
                    "source": [ "obj-9910", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9912", 0 ],
                    "source": [ "obj-9911", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9913", 0 ],
                    "source": [ "obj-9911", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9903", 0 ],
                    "source": [ "obj-9912", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9903", 0 ],
                    "source": [ "obj-9913", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-500", 0 ],
                    "source": [ "obj-9920", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-500", 0 ],
                    "source": [ "obj-9921", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-7013", 1 ],
                    "source": [ "obj-9922", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-500", 0 ],
                    "source": [ "obj-9930", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-10013", 0 ],
                    "source": [ "obj-9961", 14 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-10014", 0 ],
                    "source": [ "obj-9961", 15 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-10015", 0 ],
                    "source": [ "obj-9961", 16 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-10016", 0 ],
                    "source": [ "obj-9961", 17 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9970", 0 ],
                    "source": [ "obj-9961", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9971", 0 ],
                    "source": [ "obj-9961", 2 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9972", 0 ],
                    "source": [ "obj-9961", 4 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9973", 0 ],
                    "source": [ "obj-9961", 6 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9978", 0 ],
                    "source": [ "obj-9961", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9979", 0 ],
                    "source": [ "obj-9961", 3 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9980", 0 ],
                    "source": [ "obj-9961", 5 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9981", 0 ],
                    "source": [ "obj-9961", 7 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9982", 0 ],
                    "source": [ "obj-9961", 12 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9992", 0 ],
                    "source": [ "obj-9961", 8 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9993", 0 ],
                    "source": [ "obj-9961", 9 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9994", 0 ],
                    "source": [ "obj-9961", 10 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9995", 0 ],
                    "source": [ "obj-9961", 11 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9974", 0 ],
                    "order": 0,
                    "source": [ "obj-9970", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9997", 0 ],
                    "order": 1,
                    "source": [ "obj-9970", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9975", 0 ],
                    "order": 0,
                    "source": [ "obj-9971", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9999", 0 ],
                    "order": 1,
                    "source": [ "obj-9971", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-10001", 0 ],
                    "order": 1,
                    "source": [ "obj-9972", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9976", 0 ],
                    "order": 0,
                    "source": [ "obj-9972", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-10003", 0 ],
                    "order": 1,
                    "source": [ "obj-9973", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9977", 0 ],
                    "order": 0,
                    "source": [ "obj-9973", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-112", 0 ],
                    "source": [ "obj-9974", 6 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-412", 0 ],
                    "source": [ "obj-9975", 6 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-312", 0 ],
                    "source": [ "obj-9976", 6 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-212", 0 ],
                    "source": [ "obj-9977", 6 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9998", 0 ],
                    "source": [ "obj-9978", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-10000", 0 ],
                    "source": [ "obj-9979", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-10002", 0 ],
                    "source": [ "obj-9980", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-10004", 0 ],
                    "source": [ "obj-9981", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-172", 0 ],
                    "source": [ "obj-9982", 7 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-187", 1 ],
                    "source": [ "obj-9982", 8 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-25", 0 ],
                    "source": [ "obj-9982", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-28", 1 ],
                    "source": [ "obj-9982", 2 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-5100", 1 ],
                    "source": [ "obj-9982", 16 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-5101", 1 ],
                    "source": [ "obj-9982", 17 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-5102", 1 ],
                    "source": [ "obj-9982", 18 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-5103", 1 ],
                    "source": [ "obj-9982", 19 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-53", 1 ],
                    "source": [ "obj-9982", 11 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-54", 0 ],
                    "source": [ "obj-9982", 10 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-61", 0 ],
                    "source": [ "obj-9982", 4 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-63", 1 ],
                    "source": [ "obj-9982", 5 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-710", 1 ],
                    "source": [ "obj-9982", 12 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-710", 0 ],
                    "source": [ "obj-9982", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-740", 1 ],
                    "source": [ "obj-9982", 15 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-740", 0 ],
                    "source": [ "obj-9982", 9 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-770", 1 ],
                    "source": [ "obj-9982", 14 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-770", 0 ],
                    "source": [ "obj-9982", 6 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-800", 1 ],
                    "source": [ "obj-9982", 13 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-800", 0 ],
                    "source": [ "obj-9982", 3 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-10005", 0 ],
                    "source": [ "obj-9992", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-10006", 0 ],
                    "source": [ "obj-9993", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-10007", 0 ],
                    "source": [ "obj-9994", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-10008", 0 ],
                    "source": [ "obj-9995", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9961", 0 ],
                    "source": [ "obj-9997", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9961", 0 ],
                    "source": [ "obj-9998", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-9961", 0 ],
                    "source": [ "obj-9999", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_LR_L_bass", 0 ],
                    "source": [ "obj-fxret_gL_bass", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_LR_L_drums", 0 ],
                    "source": [ "obj-fxret_gL_drums", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_LR_L_melody", 0 ],
                    "source": [ "obj-fxret_gL_melody", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_LR_L_vocals", 0 ],
                    "source": [ "obj-fxret_gL_vocals", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_LR_R_bass", 0 ],
                    "source": [ "obj-fxret_gR_bass", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_LR_R_drums", 0 ],
                    "source": [ "obj-fxret_gR_drums", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_LR_R_melody", 0 ],
                    "source": [ "obj-fxret_gR_melody", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_LR_R_vocals", 0 ],
                    "source": [ "obj-fxret_gR_vocals", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-fxret_gL_bass", 1 ],
                    "order": 1,
                    "source": [ "obj-fxret_rcv_bass", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-fxret_gR_bass", 1 ],
                    "order": 0,
                    "source": [ "obj-fxret_rcv_bass", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-fxret_gL_drums", 1 ],
                    "order": 1,
                    "source": [ "obj-fxret_rcv_drums", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-fxret_gR_drums", 1 ],
                    "order": 0,
                    "source": [ "obj-fxret_rcv_drums", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-fxret_gL_melody", 1 ],
                    "order": 1,
                    "source": [ "obj-fxret_rcv_melody", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-fxret_gR_melody", 1 ],
                    "order": 0,
                    "source": [ "obj-fxret_rcv_melody", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-fxret_gL_vocals", 1 ],
                    "order": 1,
                    "source": [ "obj-fxret_rcv_vocals", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-fxret_gR_vocals", 1 ],
                    "order": 0,
                    "source": [ "obj-fxret_rcv_vocals", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum_FL_bass", 0 ],
                    "source": [ "obj-jp_FL_L_bass", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum_RL_bass", 0 ],
                    "source": [ "obj-jp_FL_L_bass", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum_FL_drums", 0 ],
                    "source": [ "obj-jp_FL_L_drums", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum_RL_drums", 0 ],
                    "source": [ "obj-jp_FL_L_drums", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum_FL_melody", 0 ],
                    "source": [ "obj-jp_FL_L_melody", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum_RL_melody", 0 ],
                    "source": [ "obj-jp_FL_L_melody", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum_FL_vocals", 0 ],
                    "source": [ "obj-jp_FL_L_vocals", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum_RL_vocals", 0 ],
                    "source": [ "obj-jp_FL_L_vocals", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum_FL_bass", 1 ],
                    "source": [ "obj-jp_FL_R_bass", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum_RL_bass", 1 ],
                    "source": [ "obj-jp_FL_R_bass", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum_FL_drums", 1 ],
                    "source": [ "obj-jp_FL_R_drums", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum_RL_drums", 1 ],
                    "source": [ "obj-jp_FL_R_drums", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum_FL_melody", 1 ],
                    "source": [ "obj-jp_FL_R_melody", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum_RL_melody", 1 ],
                    "source": [ "obj-jp_FL_R_melody", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum_FL_vocals", 1 ],
                    "source": [ "obj-jp_FL_R_vocals", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum_RL_vocals", 1 ],
                    "source": [ "obj-jp_FL_R_vocals", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum_FR_bass", 0 ],
                    "source": [ "obj-jp_FR_L_bass", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum_RR_bass", 0 ],
                    "source": [ "obj-jp_FR_L_bass", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum_FR_drums", 0 ],
                    "source": [ "obj-jp_FR_L_drums", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum_RR_drums", 0 ],
                    "source": [ "obj-jp_FR_L_drums", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum_FR_melody", 0 ],
                    "source": [ "obj-jp_FR_L_melody", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum_RR_melody", 0 ],
                    "source": [ "obj-jp_FR_L_melody", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum_FR_vocals", 0 ],
                    "source": [ "obj-jp_FR_L_vocals", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum_RR_vocals", 0 ],
                    "source": [ "obj-jp_FR_L_vocals", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum_FR_bass", 1 ],
                    "source": [ "obj-jp_FR_R_bass", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum_RR_bass", 1 ],
                    "source": [ "obj-jp_FR_R_bass", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum_FR_drums", 1 ],
                    "source": [ "obj-jp_FR_R_drums", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum_RR_drums", 1 ],
                    "source": [ "obj-jp_FR_R_drums", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum_FR_melody", 1 ],
                    "source": [ "obj-jp_FR_R_melody", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum_RR_melody", 1 ],
                    "source": [ "obj-jp_FR_R_melody", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum_FR_vocals", 1 ],
                    "source": [ "obj-jp_FR_R_vocals", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum_RR_vocals", 1 ],
                    "source": [ "obj-jp_FR_R_vocals", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_FL_L_bass", 0 ],
                    "source": [ "obj-jp_LR_L_bass", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_FR_L_bass", 0 ],
                    "source": [ "obj-jp_LR_L_bass", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_FL_L_drums", 0 ],
                    "source": [ "obj-jp_LR_L_drums", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_FR_L_drums", 0 ],
                    "source": [ "obj-jp_LR_L_drums", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_FL_L_melody", 0 ],
                    "source": [ "obj-jp_LR_L_melody", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_FR_L_melody", 0 ],
                    "source": [ "obj-jp_LR_L_melody", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_FL_L_vocals", 0 ],
                    "source": [ "obj-jp_LR_L_vocals", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_FR_L_vocals", 0 ],
                    "source": [ "obj-jp_LR_L_vocals", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_FL_R_bass", 0 ],
                    "source": [ "obj-jp_LR_R_bass", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_FR_R_bass", 0 ],
                    "source": [ "obj-jp_LR_R_bass", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_FL_R_drums", 0 ],
                    "source": [ "obj-jp_LR_R_drums", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_FR_R_drums", 0 ],
                    "source": [ "obj-jp_LR_R_drums", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_FL_R_melody", 0 ],
                    "source": [ "obj-jp_LR_R_melody", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_FR_R_melody", 0 ],
                    "source": [ "obj-jp_LR_R_melody", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_FL_R_vocals", 0 ],
                    "source": [ "obj-jp_LR_R_vocals", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_FR_R_vocals", 0 ],
                    "source": [ "obj-jp_LR_R_vocals", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpk_FL", 0 ],
                    "order": 1,
                    "source": [ "obj-jpfinal_FL", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-mj_sum_L", 0 ],
                    "order": 0,
                    "source": [ "obj-jpfinal_FL", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpk_FR", 0 ],
                    "order": 1,
                    "source": [ "obj-jpfinal_FR", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-mj_sum_R", 0 ],
                    "order": 0,
                    "source": [ "obj-jpfinal_FR", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpk_RL", 0 ],
                    "order": 0,
                    "source": [ "obj-jpfinal_RL", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-mj_sum_L", 1 ],
                    "order": 1,
                    "source": [ "obj-jpfinal_RL", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpk_RR", 0 ],
                    "order": 0,
                    "source": [ "obj-jpfinal_RR", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-mj_sum_R", 1 ],
                    "order": 1,
                    "source": [ "obj-jpfinal_RR", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpre_FL", 0 ],
                    "source": [ "obj-jpk_FL", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpre_FR", 0 ],
                    "source": [ "obj-jpk_FR", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpre_RL", 0 ],
                    "source": [ "obj-jpk_RL", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpre_RR", 0 ],
                    "source": [ "obj-jpk_RR", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-7013", 1 ],
                    "source": [ "obj-jpre_FL", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-7013", 1 ],
                    "source": [ "obj-jpre_FR", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-7013", 1 ],
                    "source": [ "obj-jpre_RL", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-7013", 1 ],
                    "source": [ "obj-jpre_RR", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpfinal_FL", 1 ],
                    "source": [ "obj-jpsum2_FL_bm", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpfinal_FL", 0 ],
                    "source": [ "obj-jpsum2_FL_vd", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpfinal_FR", 1 ],
                    "source": [ "obj-jpsum2_FR_bm", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpfinal_FR", 0 ],
                    "source": [ "obj-jpsum2_FR_vd", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpfinal_RL", 1 ],
                    "source": [ "obj-jpsum2_RL_bm", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpfinal_RL", 0 ],
                    "source": [ "obj-jpsum2_RL_vd", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpfinal_RR", 1 ],
                    "source": [ "obj-jpsum2_RR_bm", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpfinal_RR", 0 ],
                    "source": [ "obj-jpsum2_RR_vd", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum2_FL_bm", 0 ],
                    "source": [ "obj-jpsum_FL_bass", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum2_FL_vd", 1 ],
                    "source": [ "obj-jpsum_FL_drums", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum2_FL_bm", 1 ],
                    "source": [ "obj-jpsum_FL_melody", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum2_FL_vd", 0 ],
                    "source": [ "obj-jpsum_FL_vocals", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum2_FR_bm", 0 ],
                    "source": [ "obj-jpsum_FR_bass", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum2_FR_vd", 1 ],
                    "source": [ "obj-jpsum_FR_drums", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum2_FR_bm", 1 ],
                    "source": [ "obj-jpsum_FR_melody", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum2_FR_vd", 0 ],
                    "source": [ "obj-jpsum_FR_vocals", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum2_RL_bm", 0 ],
                    "source": [ "obj-jpsum_RL_bass", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum2_RL_vd", 1 ],
                    "source": [ "obj-jpsum_RL_drums", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum2_RL_bm", 1 ],
                    "source": [ "obj-jpsum_RL_melody", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum2_RL_vd", 0 ],
                    "source": [ "obj-jpsum_RL_vocals", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum2_RR_bm", 0 ],
                    "source": [ "obj-jpsum_RR_bass", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum2_RR_vd", 1 ],
                    "source": [ "obj-jpsum_RR_drums", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum2_RR_bm", 1 ],
                    "source": [ "obj-jpsum_RR_melody", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jpsum2_RR_vd", 0 ],
                    "source": [ "obj-jpsum_RR_vocals", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-mj_final_FL", 0 ],
                    "source": [ "obj-mj_FL_L", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-mj_final_RL", 0 ],
                    "source": [ "obj-mj_FL_L", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-mj_final_FL", 1 ],
                    "source": [ "obj-mj_FL_R", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-mj_final_RL", 1 ],
                    "source": [ "obj-mj_FL_R", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-mj_final_FR", 0 ],
                    "source": [ "obj-mj_FR_L", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-mj_final_RR", 0 ],
                    "source": [ "obj-mj_FR_L", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-mj_final_FR", 1 ],
                    "source": [ "obj-mj_FR_R", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-mj_final_RR", 1 ],
                    "source": [ "obj-mj_FR_R", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-mj_FL_L", 0 ],
                    "source": [ "obj-mj_LR_L", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-mj_FR_L", 0 ],
                    "source": [ "obj-mj_LR_L", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-mj_FL_R", 0 ],
                    "source": [ "obj-mj_LR_R", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-mj_FR_R", 0 ],
                    "source": [ "obj-mj_LR_R", 1 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-111", 0 ],
                    "order": 1,
                    "source": [ "obj-mj_final_FL", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-stereo_sum_L", 0 ],
                    "order": 0,
                    "source": [ "obj-mj_final_FL", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-76", 0 ],
                    "order": 1,
                    "source": [ "obj-mj_final_FR", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-stereo_sum_R", 0 ],
                    "order": 0,
                    "source": [ "obj-mj_final_FR", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-66", 0 ],
                    "order": 0,
                    "source": [ "obj-mj_final_RL", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-stereo_sum_L", 1 ],
                    "order": 1,
                    "source": [ "obj-mj_final_RL", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-65", 0 ],
                    "order": 0,
                    "source": [ "obj-mj_final_RR", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-stereo_sum_R", 1 ],
                    "order": 1,
                    "source": [ "obj-mj_final_RR", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-mj_LR_L", 0 ],
                    "source": [ "obj-mj_sum_L", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-mj_LR_R", 0 ],
                    "source": [ "obj-mj_sum_R", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_LR_L_bass", 1 ],
                    "order": 1,
                    "source": [ "obj-rcv_joyX_bass", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_LR_R_bass", 1 ],
                    "order": 0,
                    "source": [ "obj-rcv_joyX_bass", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_LR_L_drums", 1 ],
                    "order": 1,
                    "source": [ "obj-rcv_joyX_drums", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_LR_R_drums", 1 ],
                    "order": 0,
                    "source": [ "obj-rcv_joyX_drums", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_LR_L_melody", 1 ],
                    "order": 1,
                    "source": [ "obj-rcv_joyX_melody", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_LR_R_melody", 1 ],
                    "order": 0,
                    "source": [ "obj-rcv_joyX_melody", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_LR_L_vocals", 1 ],
                    "order": 1,
                    "source": [ "obj-rcv_joyX_vocals", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_LR_R_vocals", 1 ],
                    "order": 0,
                    "source": [ "obj-rcv_joyX_vocals", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_FL_L_bass", 1 ],
                    "order": 3,
                    "source": [ "obj-rcv_joyY_bass", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_FL_R_bass", 1 ],
                    "order": 1,
                    "source": [ "obj-rcv_joyY_bass", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_FR_L_bass", 1 ],
                    "order": 2,
                    "source": [ "obj-rcv_joyY_bass", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_FR_R_bass", 1 ],
                    "order": 0,
                    "source": [ "obj-rcv_joyY_bass", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_FL_L_drums", 1 ],
                    "order": 3,
                    "source": [ "obj-rcv_joyY_drums", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_FL_R_drums", 1 ],
                    "order": 1,
                    "source": [ "obj-rcv_joyY_drums", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_FR_L_drums", 1 ],
                    "order": 2,
                    "source": [ "obj-rcv_joyY_drums", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_FR_R_drums", 1 ],
                    "order": 0,
                    "source": [ "obj-rcv_joyY_drums", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_FL_L_melody", 1 ],
                    "order": 3,
                    "source": [ "obj-rcv_joyY_melody", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_FL_R_melody", 1 ],
                    "order": 1,
                    "source": [ "obj-rcv_joyY_melody", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_FR_L_melody", 1 ],
                    "order": 2,
                    "source": [ "obj-rcv_joyY_melody", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_FR_R_melody", 1 ],
                    "order": 0,
                    "source": [ "obj-rcv_joyY_melody", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_FL_L_vocals", 1 ],
                    "order": 3,
                    "source": [ "obj-rcv_joyY_vocals", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_FL_R_vocals", 1 ],
                    "order": 1,
                    "source": [ "obj-rcv_joyY_vocals", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_FR_L_vocals", 1 ],
                    "order": 2,
                    "source": [ "obj-rcv_joyY_vocals", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-jp_FR_R_vocals", 1 ],
                    "order": 0,
                    "source": [ "obj-rcv_joyY_vocals", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-mj_LR_L", 1 ],
                    "order": 1,
                    "source": [ "obj-rcv_masterJoyX", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-mj_LR_R", 1 ],
                    "order": 0,
                    "source": [ "obj-rcv_masterJoyX", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-mj_FL_L", 1 ],
                    "order": 3,
                    "source": [ "obj-rcv_masterJoyY", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-mj_FL_R", 1 ],
                    "order": 1,
                    "source": [ "obj-rcv_masterJoyY", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-mj_FR_L", 1 ],
                    "order": 2,
                    "source": [ "obj-rcv_masterJoyY", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-mj_FR_R", 1 ],
                    "order": 0,
                    "source": [ "obj-rcv_masterJoyY", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-21070", 0 ],
                    "source": [ "obj-stereo_sum_L", 0 ]
                }
            },
            {
                "patchline": {
                    "destination": [ "obj-21071", 0 ],
                    "source": [ "obj-stereo_sum_R", 0 ]
                }
            }
        ],
        "parameters": {
            "obj-111": [ "live.gain~[3]", "live.gain~", 0 ],
            "obj-159": [ "live.gain~[4]", "live.gain~", 0 ],
            "obj-160": [ "live.gain~[5]", "live.gain~", 0 ],
            "obj-65": [ "live.gain~", "live.gain~", 0 ],
            "obj-66": [ "live.gain~[1]", "live.gain~", 0 ],
            "obj-76": [ "live.gain~[2]", "live.gain~", 0 ],
            "parameterbanks": {
                "0": {
                    "index": 0,
                    "name": "",
                    "parameters": [ "-", "-", "-", "-", "-", "-", "-", "-" ],
                    "buttons": [ "-", "-", "-", "-", "-", "-", "-", "-" ]
                }
            },
            "inherited_shortname": 1
        },
        "autosave": 0
    }
}