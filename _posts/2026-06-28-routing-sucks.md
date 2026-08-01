---
layout: post
title: "why agentic model routing is almost impossible"
date: 2026-06-28
slug: routing-sucks
category: essay
---

i don't think i would ever use a model router for a coding agent. here's why

## 0. i don't trust your routing

your router is not calibrated on my data. you can argue all you want about the rest but fundamentally you will hit this problem your router is probably going to be calibrated off of much less data than i will eventually put through it, and different data. you'll probably be routing off of the mean success rate over k trials, instead of making sure i see a failed route only x% of the time, which matters especially in multi-turn/consistency sensitive contexts. generously, even if you were to somehow continuously calibrate to near-perfection over my actual usage distribution, UX problems are still abound. 

## 1. as a user model routing always feels bad

telling the user that you're routing the model essentially creates regret out of thin air. now, every time i use the routed model, i wonder if i could have gotten my question answered/task solved faster/cheaper with a dumber model. so you get a little papercut on every request. and then if you route me wrong, or even if im simply unsatsified with the request, i will blame you and your router even before blaming the model. i'll feel like i wasted time/money on a dumb answer when if i used the smartest possible model, i know i never have to regret. and why shouldn't i just use the smartest model every time? (even if you try to hide the model routing from the user, they will find out, and then you have a trust problem on top of a routing problem.)

## 2. your actual users don't care

notice that much of the discourse on model routing is centered around cost. cost is a CFO/management concern, not a developer concern. if i could use unlimited fast mode of the smartest models and fan out like 3 of them for each task i probably would. so at best you can convince me that you'll route me to the fastest model each time so i can get my tasks done quicker. but this is hard to measure because fastest model in tok/s is different from wall clock time to completing task. 

see the [DeepSWE leaderboard](https://deepswe.datacurve.ai/) — frontier models at different effort levels dominate the pareto frontier on both cost and output tokens, and open models are at least 1.5x away on tok/s for latency. turns out the smartest model is often also the cheapest and takes the fewest tokens! and so your 'model routing' literally adds a latency cost to each of your requests so you have the chance of having a worse model. why would i want this lol? seems like what you really want is effort routing, which still has every problem mentioned above.

i'll concede the point that if you can get greater than half an OOM or so faster, sometimes a smaller model wins on latency against the frontier, even with the prior caveats on product UX. but it turns out that when you leave single-turn eval world it gets even worse.

## 3. you don't have enough information to route models from turn 1

most users do not specify the task as neatly as you might want to calibrate your router. these are chatbots that people have multi-turn conversations with. not google searches.

think of it like customer service. a significant amount of the conversation actually goes into figuring out what the user's problem is/what they want. 

a user might open with wanting to understand how the repo does something, a pasted message from a user bug report, or literally just 'hi'. people tend to work with these models rather iteratively, not the fire-and-forget full upfront context that an eval task you'd calibrate a router on would have. (backed up by real session data[^1])

the tasks themselves are non-stationary in difficulty. what at first sounds like a UI issue turns into a horrific exploration of how the code has improperly used `setTimeout` and `useEffect`. or you might waste a query to a very smart model because you described a complex bug, when the issue was that you didnt export an environment variable. 

## 4. you can't reroute cheaply/quickly

you might argue you could do turn level routing, we can just use a smaller model for a few turns, then go back to the smarter model when the task gets hard right? well, every time you swap models, you're incurring a latency/cost to the user, which is what we're trying to avoid! most providers will cache recent inputs, so when you send a new message to an agent, the 100k tokens of context so far hit cache and are much faster/cheaper than otherwise. google kv cache for more on this. 

## 5. user behavior/people get attached to models lol

what about the advisor pattern? why don't we do a one-time escalation to a smarter model for the rest of the session if we need it, or have the full session be driven by a smaller model that has a tool call to a smarter one? 
turns out people really like talking to smarter models. see anecdotes on Fable/etc. you see people constantly switching between the top k to make sure they're getting the best model. else you wouldn't see so much powerscaling chat on twitter about 'oh actually this model is better for frontend' etc.

and each model feels different to use. each one is its own coworker personality. sure, users might still choose to use claude for codebase understanding, gpt for blowing up hard debugging problems, and GLM for frontend, but the user chose those! 

so basically in order to successfully even attempt model routing you need to accustom users to working with less intelligent models, potentially accept huge KV cache cost hits on bad routing, otherwise magically intuit or force your users to detail the full scope of the task before it starts, overcome the frontier dominance and intelligence using fewer tokens for the same problem, solve user regret on every routing decision you make or hide the routing, and continuously calibrate to my data. please drop the github link once you do. 

raise NotImplementedError()

---

[^1]: see [SWE-Chat](https://arxiv.org/pdf/2604.20779) for more on this

<blockquote class="twitter-tweet"><a href="https://x.com/FactoryAI/status/2061862733126275549"></a></blockquote>

<blockquote class="twitter-tweet"><a href="https://x.com/brian_armstrong/status/2070670644577280109"></a></blockquote>

<blockquote class="twitter-tweet"><a href="https://x.com/thdxr/status/2069024649166602417"></a></blockquote>

