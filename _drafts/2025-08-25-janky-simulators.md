---
layout: post
title: "janky simulators might be enough"
date: 2025-08-25
slug: janky-simulators
---

everyone and their mom heard about alphazero's chess dominance, and the ripple effect self-play engines have had on the game of chess. you now see more of the 'h-pawn' motif to open up the rook and attack the king, plays favoring initiative and restricting opponent movement over raw material, etc. Magnus Carlsen himself has referenced how alphazero's playstyle has impacted his own. to be fair, chess benefits greatly from this well-defined action space, high fidelity simulation environment. the state of the game can be expressed with as little as a 2D array of <>. but this level of fidelity isn't a necessary condition for self-play led metagame shifts. 

talk to any kid who grew up playing Madden, they could've predicted many of the recent meta shifts in the NFL. kids hate punting and love to run with the QB. and what do we see in the NFL? from 1999 to 2017, only around 10% of 4th downs were attempted. since 2018, its never been below 15%. in the 2024 season, the league-wide rate was almost 20%. perhaps vitalized by the infamous Madden '04 Michael Vick, the dual threat QB (Cam, Russell Wilson, Patrick Mahomes, Lamar Jackson) has completely replaced the old guard Peyton Manning archetype. its almost a requirement nowadays that a highly drafted rookie QB be able to run the football or throw on the run. 

this effect isn't limited to kids strategies, or even the NFL. plenty of discussion in the NBA as of late has been around the absurd increase in 3 point attempts, vitalized by Steph Curry. the lowest 3 point attempt rate last season, around 35%, would've been the highest back in 2009. professional madden players abuse pre-snap motion, and its surged in the NFL as well. last season saw around 30% of plays with pre-snap motion almost double 2018's ~16%. 

one might claim that the causation doesn't hold here. why the games specifically? maybe players just got better, revealing these strategies? but then why would 3 point % be stable year over year in that period of 09-24, in the range of 34-36%? while QBs now might get more favor from referees with roughing the passer calls, Cam Newton and Russell Wilson didn't have that luxury back in the '10s as the meta came into play. nothing significant has changed in the 4th down meta, except maybe the tush push. and its arguable that anyone is even really doing that well other than the eagles. league-wide rates for 4th downs are still up. 

in any case, its clear that there are human biases that hide obvious inefficiencies in environments like the above in sports. sample size bias and 'resulting' hiding the power of aggressive 4th down strategies. conventional wisdom obscuring the effectiveness of running QBs. risk aversion hiding that the EV of a 3 pointer was so much better than the long range 2. if these can be revealed even with imperfect simulators, what are the parts to get right? 

incentives obviously need to stay in check. winning the game is the most important reward, maybe with some proxy play-level metrics like EPA for smoothing. all possible actions within the rules of the game need to be represented. self-play in a football game where the QB can't run because the developer didn't bother to add the mechanic wouldn't have revealed the strategy. and if you have the above two down, all you need is agents smart enough to bootstrap and improve each other. and your self-play will stress test the boundaries of the simulation itself, eventually making it just representative enough to be instructive.

so maybe janky simulators are enough.

[seed-prover](https://arxiv.org/abs/2507.23726) shows us that the simulation doesn't have to be player versus player, we can scale player versus verifier. perhaps advanced models like cicero might use [diplomacy](https://github.com/facebookresearch/diplomacy_cicero) as a coarse simulator of geopolitical strategy. perhaps LLMs themselves can be the simulator for human [cognition](https://x.com/koalacrown/status/1926486028161876437). 

TODO: 
- this feels like observations but nothing very novel? 
- doesn't fulfill on promise of janky simulators being enough beyond video games -> sports. maybe another phase of example here with a janky simulator leading to scientific advancement? or is it enough to just make this claim as a 'please go write simulators even if they suck bc it might still be useful'. how would i even write that claim
- 