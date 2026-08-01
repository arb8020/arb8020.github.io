---
layout: post
title: "janky simulators might be enough"
date: 2025-08-25
slug: janky-simulators
category: essay
---

everyone and their mom heard about alphazero's chess dominance, and the ripple effect self-play engines have had on the game of chess. you now see more of the 'h-pawn' motif to open up the rook and attack the king, plays favoring initiative and restricting opponent movement over raw material, etc. Magnus Carlsen himself has referenced how alphazero's playstyle has impacted his own. to be fair, chess benefits greatly from this well-defined action space, high fidelity simulation environment. the state of the game can be expressed with as little as a 2D array of <>. but this level of fidelity isn't a necessary condition for self-play led metagame shifts. 

talk to any kid who grew up playing Madden, they could've predicted many of the recent meta shifts in the NFL. kids hate punting and love to run with the QB. and what do we see in the NFL? from 1999 to 2017, only around 10% of 4th downs were attempted. since 2018, its never been below 15%. in the 2024 season, the league-wide rate was almost 20%. perhaps vitalized by the infamous Madden '04 Michael Vick, the dual threat QB (Cam, Russell Wilson, Patrick Mahomes, Lamar Jackson) has completely replaced the old guard Peyton Manning archetype. its almost a requirement nowadays that a highly drafted rookie QB be able to run the football or throw on the run. and its not just the NFL. the lowest 3 point attempt rate of a given team in the 2024 season, around 35%, would've been league-highest in 2009. 

its clear that human biases might hide obvious inefficiencies in environments like the above in sports. sample size bias and 'resulting' hiding the power of aggressive 4th down strategies. conventional wisdom obscuring the effectiveness of running QBs. risk aversion hiding that the EV of a 3 pointer was so much better than the long range 2. if these can be revealed even with imperfect simulators, what are the parts to get right? 

incentives obviously need to stay in check. winning the game is the most important reward, maybe with some proxy play-level metrics like EPA for smoothing. all possible actions within the rules of the game need to be represented. self-play in a football game where the QB can't run because the developer didn't bother to add the mechanic wouldn't have revealed the strategy. and if you have the above two down, all you need is agents smart enough to bootstrap and improve each other. and your self-play will stress test the boundaries of the simulation itself, eventually making it just representative enough to be instructive.

so maybe janky simulators are enough.

[seed-prover](https://arxiv.org/abs/2507.23726) shows us that the simulation doesn't have to be player versus player, we can scale player versus verifier. perhaps advanced models like cicero might use [diplomacy](https://github.com/facebookresearch/diplomacy_cicero) as a coarse simulator of geopolitical strategy. perhaps LLMs themselves can be the simulator for human [cognition](https://x.com/koalacrown/status/1926486028161876437). 

TODO:
- Add explanation of WHY janky sims work: volume/iteration (tons more Madden games played than real NFL games, so high EV strategies emerge faster), risk-free experimentation, compounds small edges
- Need high-stakes non-sports example to prove causality (sports examples are correlational)
  - OpenAI Dactyl: couldn't model contact physics (unsolved problem) → randomized everything (mass, friction, grip, lighting) → 100 simulated years → solved Rubik's cube 60% of time on real robot, zero real-world training → shows "make it jankier on purpose" works when you can't build accurate sim
  - Waymo: 20 billion sim miles vs 20 million real (1000:1 ratio), one day in sim = 100 years real driving, uses sim to test fatal crash scenarios → shows volume/iteration speed advantage
- Iteration loop: "if we notice reward hacking we can fix the simulator" needs concrete example
  - Domain randomization itself is this: robots failed on real hardware → made sim MORE random → worked
- Final beat should be: stop waiting for perfect sim, build janky one and run it a million times
- Consider: cost/accessibility angle (10,000 Madden seasons costs $60, real NFL team costs billions)
- Consider: safety/ethics angle (some experiments can ONLY happen in sim - fatal crashes, pandemics, geopolitical crises)
