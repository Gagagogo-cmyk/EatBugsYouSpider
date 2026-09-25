# STUDY PROPOSAL

## Gnumbat! (Gnumbat)

*An independent study in generative audio systems, music information retrieval, and digital music culture*

---

### 1. Purpose and Goals

Gnumbat! (Gnumbat) is a real-time generative audio instrument and open-source platform that lets a musician deconstruct existing recordings into their component stems and descriptors, and recombine that material — live, and steered by natural-language instruction — into arrangements that have never existed before. Inspired by Winamp, Gnumbat treats a music library as a space to explore rather than a playlist to press play on. The proposed independent study uses the continued design, implementation, and critical documentation of Gnumbat as its object of research, situated at the intersection of music information retrieval, human–AI creative interaction, and remix/sampling culture.

The project responds to a concrete compositional problem: a large personal archive of unfinished musical fragments, and an interest in exploring the alternate forms those fragments could take by recombining them with other material rather than finishing each one in isolation. Gnumbat externalizes that process into an instrument — one that other musicians and communities can also use and adapt, since the codebase is released under the AGPL-3.0 license.

Beyond the instrument, a further goal of the study is to grow Gnumbat's web layer into an open platform for electronic-music communities — a space to document local scenes, discover shows, and connect artists and listeners. Rather than build this on top of an existing corporate platform, the intent is to make it independently: each community would keep its own data and could run its own instance, as an alternative for musicians and scenes who want a space like this without depending on something like Instagram.

Specific goals for the study period:

- Complete the migration of the real-time audio engine from Max/MSP (proprietary, subscription-based) to Pure Data (open source), restructuring the analysis pipeline so it can also drive a continuous web-radio stream.
- Refine the descriptor-based slicing pipeline — Demucs stem separation, FluCoMa spectral/timbral descriptors, Essentia genre classification, and madmom tempo/downbeat tracking — and evaluate how well the resulting slice index supports musically coherent, non-repeating recombination.
- Develop and test the "bake" training loop, by which a user teaches the system what a natural-language prompt (e.g. "rise," "drop") should sound like from worked audio examples, and evaluate whether a locally run language model (Llama 3.1 via Ollama) can reliably translate open-ended natural-language instruction into slice-selection commands.
- Build out the platform's community layer — a user-defined, evolving genre taxonomy, artist/community profiles, and "spiderbots," LLM-driven crawler agents that track live electronic-music events across venue websites — as an independent space for music scenes, rather than depending on an existing platform like Instagram.

Expected deliverables include a working, documented, open-source build of the instrument and platform (published to the project's public GitHub repository); the accompanying technical documentation; and a written component connecting the practical work to the research questions and bibliography below.

### 2. Bibliography

**Technical and software references:**

- Rouard, S., Massa, F., & Défossez, A. (2023). Hybrid transformers for music source separation. arXiv:2211.08553. https://arxiv.org/abs/2211.08553
- Tremblay, P. A., Roma, G., & Green, O. (2021). Enabling programmatic data mining as musicking: The Fluid Corpus Manipulation toolkit. *Computer Music Journal*, 45(2), 9–23. MIT Press.
- Bogdanov, D., Wack, N., Gómez, E., Gulati, S., Herrera, P., Mayor, O., Roma, G., Salamon, J., Zapata, J., & Serra, X. (2013). ESSENTIA: An audio analysis library for music information retrieval. *Proceedings of the 14th International Society for Music Information Retrieval Conference (ISMIR 2013)*.
- Böck, S., Korzeniowski, F., Schlüter, J., Krebs, F., & Widmer, G. (2016). madmom: A new Python audio and music signal processing library. *Proceedings of the 24th ACM International Conference on Multimedia*, 1174–1178. arXiv:1605.07008.
- Touvron, H., Lavril, T., Izacard, G., Martinet, X., Lachaux, M.-A., Lacroix, T., Rozière, B., Goyal, N., Hambro, E., Azhar, F., Rodriguez, A., Joulin, A., Grave, E., & Lample, G. (2023). LLaMA: Open and efficient foundation language models. arXiv:2302.13971.
- Ollama (2023–present). Local large language model runtime [Software]. https://ollama.com

**Theoretical and critical references:**

- Manovich, L. (1999). Database as a symbolic form. *Millennium Film Journal*, 34. Reprinted in expanded form in *The Language of New Media* (2001, MIT Press).
- Navas, E. (2012). *Remix theory: The aesthetics of sampling.* Springer/Birkhäuser.
- McDonald, G. (2013–present). Every Noise at Once [Data visualization / genre-mapping project]. https://everynoise.com

**Project documentation (primary sources, produced in the course of the work):**

- Gagné, A. Gnumbat technical architecture, tech-stack, and design documentation (ARCHITECTURE.md, TECH_STACK.md, ILM.md, and related files). Internal project repository, 2023–present.
- Gagné, A. (2026). Gnumbat! — Exploration et recherche, Arts numériques [Grant proposal]. Conseil des arts et des lettres du Québec.

### 3. Research Methodology

The study follows a practice-based / research-creation methodology: the artifact (the Gnumbat instrument and platform) is both the object under construction and the site where the research questions are tested. Development proceeds iteratively — build, listen, adjust the descriptor set or training data, and document — with the project's own written documentation (kept in-repository and versioned in git) serving as a running research journal that records design decisions and their rationale as they are made, rather than reconstructing them after the fact.

The methodology has four phases, scaled to a standard 13-week academic term:

- **Phase 1 — Engine migration** (Weeks 1–3): Port the real-time audio engine from Max/MSP to Pure Data; verify feature parity; stabilize the base architecture.
- **Phase 2 — Training and remixing systems** (Weeks 4–9): Iteratively test the descriptor pipeline and the "bake" training loop; calibrate slice/descriptor behavior against listening evaluation; document the architecture as it stabilizes.
- **Phase 3 — Platform and community layer** (Weeks 4–9, in parallel): Refine the spiderbots (the event-tracking crawler agents) and the community-facing genre taxonomy; test reliability of the natural-language crawling approach.
- **Phase 4 — Public release and reflection** (Weeks 10–13): Stage a progressive public launch; consolidate documentation; write the final reflective component connecting the practical outcomes to the bibliography and research questions above.

Evaluation of the technical work is primarily qualitative and listening-based (does a given change make recombination more musically coherent or more interesting?), supplemented by the system's own descriptor data where it is useful (e.g. checking that trained "bakes" separate cleanly in descriptor space). The critical/theoretical component is developed through close reading of the bibliography against the artifact's actual behavior, rather than as a separate literature exercise.
