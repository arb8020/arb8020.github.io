---
layout: post
title: "hedging is not about decreasing position size"
date: 2026-08-01
slug: hedging-specificity
category: essay
---

when making bets, you should hedge/net out only the risks you aren't being paid to take. hedging is about specificity not sizing. sizing down only decreases ur variance but ur also going to profit from any alpha less. 

you can go from a vague take where you do a generic hedge/variance reduction with like 'idk tho' or 'im not sure' to explicitly naming at least your confidence %. you can even state the specific events that would falsify your thesis, which helps you then act more easily because now the risks you are exposed to are more specific. 

you can argue this makes it easier to be Very Wrong but it also means 1. you get a better gradient for next time and 2. you can't lose money when you should have been 'right'. no crying in the casino.

classic example: catalyst is coming up for some biotech stock. you long the biotech stock. catalyst goes very well but broad market is down 5% and ur biotech stock is down 3%. had u shorted the market with the correct sizing based on like covariance or whatever you could instead be up.

this leads into risk factor modeling and the reader should look at the barra USE3 equity risk model handbook for the industrial-strength version.

we should also note that working out 'what you get paid for' from this no free lunch assumption is basically how you re-derive option pricing from first principles. and why you should be delta hedging if you only have a view on vol.

the broader point: this applies to communication and thinking, not just trading.
- "idk tho" is the equivalent of sizing down. you reduce variance of being wrong but you also reduce your alpha
- naming your specific uncertainties is the real hedge. "i think X, but if Y happens i'm wrong" — now you know what to watch for
- stating falsification criteria = defining your stop loss. you know when to get out vs when to hold
- "dinner dates are a bad first date idea" is an unhedged position with a lot of market exposure. "dinner dates are tricky because you're solely judging conversational ability in a high-commitment setting" is the hedged version — it specifies the risk (conversational pressure) and lets someone who's good at conversation realize the trade works for them

<!--claude
notes/questions:
- the biotech math example needs rough numbers to land. something like: biotech +10% on catalyst, market -5%, beta ~1.2. unhedged you're down despite being right. hedged (short SPY sized by beta) you capture the alpha. want me to draft the math?
- the vault has a LOT more raw conversation material on this (the "hedging and precision" note). the mass/surface area framing, the gut-to-words loop, the "shapes not confidence levels" line. how much do you want to pull in vs keep this tight?
- option pricing from first principles + delta hedging — worth a paragraph each or just a pointer? feels like it could become its own post
- title still doesn't feel snappy to me. "hedging is not about decreasing position size" is accurate but long. the vault had "honest hedging" and "hedge to clarify, not to hide" as candidates. or maybe something falls out of the writing
- the "no crying in the casino" line is great, might work as a section header
-->
