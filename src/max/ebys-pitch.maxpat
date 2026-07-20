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
  "rect": [
   100.0,
   100.0,
   900.0,
   750.0
  ],
  "boxes": [
   {
    "box": {
     "id": "obj-1",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 3,
     "patching_rect": [
      50,
      20,
      140,
      22
     ],
     "text": "fftin~ 1 hanning",
     "outlettype": [
      "signal",
      "signal",
      "signal"
     ]
    }
   },
   {
    "box": {
     "id": "obj-4",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "patching_rect": [
      700,
      20,
      140,
      22
     ],
     "text": "in 2",
     "outlettype": [
      ""
     ],
     "saved_object_attributes": {
      "attr_comment": "",
      "c": ""
     }
    }
   },
   {
    "box": {
     "id": "obj-5",
     "maxclass": "newobj",
     "numinlets": 0,
     "numoutlets": 1,
     "patching_rect": [
      900,
      20,
      140,
      22
     ],
     "text": "receive ebys_pitchWindow",
     "outlettype": [
      ""
     ],
     "comment": "broadcasts to all 4 stems' pfft~ copies at once \u2014 see slot_router.js's setWindow()"
    }
   },
   {
    "box": {
     "id": "obj-2",
     "maxclass": "newobj",
     "numinlets": 3,
     "numoutlets": 2,
     "patching_rect": [
      50,
      420,
      140,
      22
     ],
     "text": "gizmo~",
     "outlettype": [
      "signal",
      "signal"
     ],
     "comment": "PITCH engine \u2014 now fed the FORMANT-FLATTENED residual spectrum (obj-19) instead of raw fftin~ output, so it resamples only the harmonic/excitation content, not the spectral envelope"
    }
   },
   {
    "box": {
     "id": "obj-3",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 0,
     "patching_rect": [
      50,
      680,
      140,
      22
     ],
     "text": "fftout~ 1 hanning"
    }
   },
   {
    "box": {
     "id": "obj-6",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "patching_rect": [
      760,
      20,
      140,
      22
     ],
     "text": "in 3",
     "outlettype": [
      ""
     ],
     "saved_object_attributes": {
      "attr_comment": "",
      "c": ""
     },
     "comment": "formant ratio \u2014 2^(n/12), independent of pitch ratio (in 2 / obj-4). 1.0 = formants untouched (default, matches ReaPitch's formant=0)"
    }
   },
   {
    "box": {
     "id": "obj-7",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 2,
     "patching_rect": [
      50,
      90,
      140,
      22
     ],
     "text": "cartopol~",
     "outlettype": [
      "signal",
      "signal"
     ],
     "comment": "original mag/phase \u2014 phase is reused untouched by the residual (obj-19) and, separately, by the shifted-residual path (obj-20)"
    }
   },
   {
    "box": {
     "id": "obj-8",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "patching_rect": [
      50,
      160,
      140,
      22
     ],
     "text": "log~ 10.",
     "outlettype": [
      "signal"
     ]
    }
   },
   {
    "box": {
     "id": "obj-9",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 3,
     "patching_rect": [
      50,
      230,
      140,
      22
     ],
     "text": "fft~ 512 512",
     "outlettype": [
      "signal",
      "signal",
      "signal"
     ],
     "comment": "cepstrum \u2014 FFT of the log-magnitude spectrum itself (nested FFT across the bin/quefrency axis, standard real-cepstrum liftering technique). Size args must match the actual vector length flowing through this subpatch, which is HALF the outer pfft~'s FFT size (1024/2=512) \u2014 fftin~ only sends the non-redundant half-spectrum of a real signal (see fftin~ docs: 'output frame is only half the size of the parent pfft~ object's FFT size'), not fft~'s own 512 default coincidentally matching. 3rd outlet is fft~'s sync ramp (0..511), feeding index~ below."
    }
   },
   {
    "box": {
     "id": "obj-11",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "patching_rect": [
      250,
      160,
      140,
      22
     ],
     "text": "buffer~ ebys_formant_lifter 512",
     "outlettype": [
      "bang"
     ],
     "comment": "filled at load by formant_lifter_init.js (loadbang below); shared by name across all 4 stems' copies of this subpatch. 512 samples to match the actual cepstrum length (see obj-9's comment) \u2014 NOT the outer pfft~'s 1024 FFT size."
    }
   },
   {
    "box": {
     "id": "obj-12",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "patching_rect": [
      250,
      300,
      140,
      22
     ],
     "text": "index~ ebys_formant_lifter",
     "outlettype": [
      "signal"
     ],
     "comment": "signal-rate buffer~ read, driven by fft~'s own sync outlet (obj-9 outlet 2) so the lifter curve lines up bin-for-bin with the cepstrum vector it's about to multiply. NOTE: peek~ (used elsewhere in this codebase for spectral-feature reads) is message/control-rate only and can't do this \u2014 index~ is the signal-rate equivalent."
    }
   },
   {
    "box": {
     "id": "obj-27",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 0,
     "patching_rect": [
      400,
      90,
      140,
      22
     ],
     "text": "js formant_lifter_init.js",
     "comment": "no patch cord needed into this — Max sends every js object its own \"loadbang\" message automatically when the (sub)patcher containing it loads, invoking this file's loadbang() function directly. A literal loadbang object wired in here would ALSO send a plain \"bang\" message on top of that, which this script has no bang() handler for (logs a harmless but noisy \"no function bang\" error) — removed for that reason."
    }
   },
   {
    "box": {
     "id": "obj-13",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "patching_rect": [
      50,
      300,
      140,
      22
     ],
     "text": "*~",
     "outlettype": [
      "signal"
     ]
    }
   },
   {
    "box": {
     "id": "obj-14",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "patching_rect": [
      150,
      300,
      140,
      22
     ],
     "text": "*~",
     "outlettype": [
      "signal"
     ]
    }
   },
   {
    "box": {
     "id": "obj-15",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 3,
     "patching_rect": [
      50,
      340,
      140,
      22
     ],
     "text": "ifft~ 512 512",
     "outlettype": [
      "signal",
      "signal",
      "signal"
     ],
     "comment": "liftered cepstrum back to the frequency domain \u2014 real output (outlet 0) is the SMOOTHED log-magnitude spectral envelope. Size args must match obj-9's. Outlet 1 (imag, should be ~0) and outlet 2 (sync) are unused."
    }
   },
   {
    "box": {
     "id": "obj-16",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "patching_rect": [
      50,
      380,
      140,
      22
     ],
     "text": "pow~ 10.",
     "outlettype": [
      "signal"
     ],
     "comment": "E(f) = 10^logMag \u2014 inverse of log~ 10. above. pow~'s LEFT inlet is the exponent (our log-magnitude signal), RIGHT inlet/creation-arg is the fixed base (10.); this is the original, UNSHIFTED spectral envelope magnitude"
    }
   },
   {
    "box": {
     "id": "obj-17",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "patching_rect": [
      150,
      380,
      140,
      22
     ],
     "text": "+~ 0.000000001",
     "outlettype": [
      "signal"
     ],
     "comment": "epsilon guard (1e-9 written out \u2014 Max's object-box parser doesn't accept scientific notation) \u2014 avoids /~ NaN/inf on silent frames where E(f) hits 0"
    }
   },
   {
    "box": {
     "id": "obj-18",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "patching_rect": [
      150,
      420,
      140,
      22
     ],
     "text": "/~",
     "outlettype": [
      "signal"
     ],
     "comment": "R(f) = original magnitude / envelope \u2014 flattened excitation/residual spectrum, envelope removed"
    }
   },
   {
    "box": {
     "id": "obj-19",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 2,
     "patching_rect": [
      150,
      460,
      140,
      22
     ],
     "text": "poltocar~",
     "outlettype": [
      "signal",
      "signal"
     ],
     "comment": "residual (R(f), original phase) -> real/imag \u2014 this, not raw fftin~ output, is what feeds gizmo~'s pitch shift"
    }
   },
   {
    "box": {
     "id": "obj-20",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 2,
     "patching_rect": [
      50,
      480,
      140,
      22
     ],
     "text": "cartopol~",
     "outlettype": [
      "signal",
      "signal"
     ],
     "comment": "BLENDED residual mag/phase — reads obj-37/obj-38, which crossfade gizmo~'s shifted output against the untouched original residual per-bin via the pitch-band mask (obj-30). Equals the fully pitch-shifted residual where the mask is 1 (in-band), the original untouched residual where it's 0 (out-of-band)."
    }
   },
   {
    "box": {
     "id": "obj-21",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "patching_rect": [
      300,
      420,
      140,
      22
     ],
     "text": "sig~ 0.",
     "outlettype": [
      "signal"
     ]
    }
   },
   {
    "box": {
     "id": "obj-22",
     "maxclass": "newobj",
     "numinlets": 3,
     "numoutlets": 2,
     "patching_rect": [
      300,
      460,
      140,
      22
     ],
     "text": "gizmo~",
     "outlettype": [
      "signal",
      "signal"
     ],
     "comment": "FORMANT engine \u2014 resamples the envelope curve E(f) by formantRatio (in 3). Ratio 1.0 = envelope passes through unchanged = classic formant-preserved pitch shift."
    }
   },
   {
    "box": {
     "id": "obj-23",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 2,
     "patching_rect": [
      300,
      500,
      140,
      22
     ],
     "text": "cartopol~",
     "outlettype": [
      "signal",
      "signal"
     ],
     "comment": "shifted-envelope magnitude (phase output unused/unconnected)"
    }
   },
   {
    "box": {
     "id": "obj-24",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "patching_rect": [
      50,
      540,
      140,
      22
     ],
     "text": "*~",
     "outlettype": [
      "signal"
     ],
     "comment": "finalMag = blendedResidualMag (obj-20, band-crossfaded pitch shift) * blendedEnvelopeMag (obj-41, band-crossfaded formant shift)"
    }
   },
   {
    "box": {
     "id": "obj-25",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 2,
     "patching_rect": [
      50,
      580,
      140,
      22
     ],
     "text": "poltocar~",
     "outlettype": [
      "signal",
      "signal"
     ],
     "comment": "(finalMag, shiftedPhase) -> real/imag -> fftout~"
    }
   },
   {
    "box": {
     "id": "obj-28",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "patching_rect": [
      550,
      160,
      160,
      22
     ],
     "text": "buffer~ ebys_pitch_mask_#1 512",
     "outlettype": [
      "bang"
     ],
     "comment": "per-STEM (via pfft~'s \"args #1\") pitch-band gate \u2014 1.0 = shift applies at this bin, 0.0 = pass through untouched. Filled full-pass at load by band_mask_init.js, overwritten by slot_router.js's setShiftBand/setPitchBand."
    }
   },
   {
    "box": {
     "id": "obj-29",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "patching_rect": [
      750,
      160,
      160,
      22
     ],
     "text": "buffer~ ebys_formant_mask_#1 512",
     "outlettype": [
      "bang"
     ],
     "comment": "same as obj-28 but for the FORMANT band \u2014 independently settable via setFormantBand, defaults to the shared band."
    }
   },
   {
    "box": {
     "id": "obj-30",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "patching_rect": [
      550,
      230,
      160,
      22
     ],
     "text": "index~ ebys_pitch_mask_#1",
     "outlettype": [
      "signal"
     ],
     "comment": "signal-rate read of the pitch-band mask, driven by fftin~'s OWN bin-sync (obj-1 outlet 2) \u2014 this is the outer spectral frame's bin index (0..511), NOT the nested cepstrum fft~'s sync (obj-9 outlet 2, a different axis: quefrency)."
    }
   },
   {
    "box": {
     "id": "obj-31",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "patching_rect": [
      750,
      230,
      160,
      22
     ],
     "text": "index~ ebys_formant_mask_#1",
     "outlettype": [
      "signal"
     ],
     "comment": "same as obj-30 but for the formant-band mask."
    }
   },
   {
    "box": {
     "id": "obj-32",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 0,
     "patching_rect": [
      650,
      90,
      160,
      22
     ],
     "text": "js band_mask_init.js #1",
     "comment": "fills both mask buffers full-pass at load \u2014 see that file's header for why. No patch cord needed: Max sends this its own \"loadbang\" message automatically when this pfft~ instance loads, invoking loadbang() directly (a wired loadbang object would ALSO send a redundant \"bang\" this script has no handler for)."
    }
   },
   {
    "box": {
     "id": "obj-33",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "patching_rect": [
      550,
      420,
      160,
      22
     ],
     "text": "-~",
     "outlettype": [
      "signal"
     ],
     "comment": "diffReal = shiftedResidualReal - originalResidualReal"
    }
   },
   {
    "box": {
     "id": "obj-34",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "patching_rect": [
      650,
      420,
      160,
      22
     ],
     "text": "-~",
     "outlettype": [
      "signal"
     ],
     "comment": "diffImag = shiftedResidualImag - originalResidualImag"
    }
   },
   {
    "box": {
     "id": "obj-35",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "patching_rect": [
      550,
      460,
      160,
      22
     ],
     "text": "*~",
     "outlettype": [
      "signal"
     ],
     "comment": "scaledDiffReal = diffReal * pitchMask"
    }
   },
   {
    "box": {
     "id": "obj-36",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "patching_rect": [
      650,
      460,
      160,
      22
     ],
     "text": "*~",
     "outlettype": [
      "signal"
     ],
     "comment": "scaledDiffImag = diffImag * pitchMask"
    }
   },
   {
    "box": {
     "id": "obj-37",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "patching_rect": [
      550,
      500,
      160,
      22
     ],
     "text": "+~",
     "outlettype": [
      "signal"
     ],
     "comment": "blendedReal = originalResidualReal + scaledDiffReal \u2014 equals shiftedReal where pitchMask=1 (in-band), originalReal where pitchMask=0 (out-of-band). Feeds obj-20 (was fed directly by obj-2)."
    }
   },
   {
    "box": {
     "id": "obj-38",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "patching_rect": [
      650,
      500,
      160,
      22
     ],
     "text": "+~",
     "outlettype": [
      "signal"
     ],
     "comment": "blendedImag \u2014 same crossfade as obj-37, imaginary part. Feeds obj-20."
    }
   },
   {
    "box": {
     "id": "obj-39",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "patching_rect": [
      850,
      460,
      160,
      22
     ],
     "text": "-~",
     "outlettype": [
      "signal"
     ],
     "comment": "diffEnv = shiftedEnvelopeMag - originalEnvelopeMag(E(f))"
    }
   },
   {
    "box": {
     "id": "obj-40",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "patching_rect": [
      850,
      500,
      160,
      22
     ],
     "text": "*~",
     "outlettype": [
      "signal"
     ],
     "comment": "scaledDiffEnv = diffEnv * formantMask"
    }
   },
   {
    "box": {
     "id": "obj-41",
     "maxclass": "newobj",
     "numinlets": 2,
     "numoutlets": 1,
     "patching_rect": [
      850,
      540,
      160,
      22
     ],
     "text": "+~",
     "outlettype": [
      "signal"
     ],
     "comment": "blendedEnvelopeMag = E(f) + scaledDiffEnv \u2014 equals shiftedEMag where formantMask=1 (in-band), E(f) unshifted where formantMask=0 (out-of-band). Feeds obj-24 (was fed directly by obj-23)."
    }
   }
  ],
  "lines": [
   {
    "patchline": {
     "destination": [
      "obj-1",
      0
     ],
     "source": [
      "obj-5",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-3",
      0
     ],
     "source": [
      "obj-5",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-7",
      0
     ],
     "source": [
      "obj-1",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-7",
      1
     ],
     "source": [
      "obj-1",
      1
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-8",
      0
     ],
     "source": [
      "obj-7",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-18",
      0
     ],
     "source": [
      "obj-7",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-19",
      1
     ],
     "source": [
      "obj-7",
      1
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-9",
      0
     ],
     "source": [
      "obj-8",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-13",
      0
     ],
     "source": [
      "obj-9",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-14",
      0
     ],
     "source": [
      "obj-9",
      1
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-12",
      0
     ],
     "source": [
      "obj-9",
      2
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-13",
      1
     ],
     "source": [
      "obj-12",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-14",
      1
     ],
     "source": [
      "obj-12",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-15",
      0
     ],
     "source": [
      "obj-13",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-15",
      1
     ],
     "source": [
      "obj-14",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-16",
      0
     ],
     "source": [
      "obj-15",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-17",
      0
     ],
     "source": [
      "obj-16",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-22",
      0
     ],
     "source": [
      "obj-16",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-18",
      1
     ],
     "source": [
      "obj-17",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-19",
      0
     ],
     "source": [
      "obj-18",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-2",
      0
     ],
     "source": [
      "obj-19",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-2",
      1
     ],
     "source": [
      "obj-19",
      1
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-2",
      2
     ],
     "source": [
      "obj-4",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-22",
      1
     ],
     "source": [
      "obj-21",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-22",
      2
     ],
     "source": [
      "obj-6",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-23",
      0
     ],
     "source": [
      "obj-22",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-23",
      1
     ],
     "source": [
      "obj-22",
      1
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-24",
      0
     ],
     "source": [
      "obj-20",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-25",
      0
     ],
     "source": [
      "obj-24",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-25",
      1
     ],
     "source": [
      "obj-20",
      1
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-3",
      0
     ],
     "source": [
      "obj-25",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-3",
      1
     ],
     "source": [
      "obj-25",
      1
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-30",
      0
     ],
     "source": [
      "obj-1",
      2
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-31",
      0
     ],
     "source": [
      "obj-1",
      2
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-33",
      0
     ],
     "source": [
      "obj-2",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-33",
      1
     ],
     "source": [
      "obj-19",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-34",
      0
     ],
     "source": [
      "obj-2",
      1
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-34",
      1
     ],
     "source": [
      "obj-19",
      1
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-35",
      0
     ],
     "source": [
      "obj-33",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-35",
      1
     ],
     "source": [
      "obj-30",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-36",
      0
     ],
     "source": [
      "obj-34",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-36",
      1
     ],
     "source": [
      "obj-30",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-37",
      0
     ],
     "source": [
      "obj-19",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-37",
      1
     ],
     "source": [
      "obj-35",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-38",
      0
     ],
     "source": [
      "obj-19",
      1
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-38",
      1
     ],
     "source": [
      "obj-36",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-39",
      0
     ],
     "source": [
      "obj-23",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-39",
      1
     ],
     "source": [
      "obj-16",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-40",
      0
     ],
     "source": [
      "obj-39",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-40",
      1
     ],
     "source": [
      "obj-31",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-41",
      0
     ],
     "source": [
      "obj-16",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-41",
      1
     ],
     "source": [
      "obj-40",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-20",
      0
     ],
     "source": [
      "obj-37",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-20",
      1
     ],
     "source": [
      "obj-38",
      0
     ]
    }
   },
   {
    "patchline": {
     "destination": [
      "obj-24",
      1
     ],
     "source": [
      "obj-41",
      0
     ]
    }
   }
  ]
 }
}