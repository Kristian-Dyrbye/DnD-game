/**
 * English engine messages (the source): system lines, facts and errors the engine writes into the
 * story log. Keys are grouped by the module that uses them. Add every new key to da.ts too.
 */
export const en = {
  // Coins (lower case, as the story text writes them)
  'coins.gp': '{n} gp',
  'coins.sp': '{n} sp',
  'coins.cp': '{n} cp',

  // Session
  'session.noGame': 'No game is running',
  'session.noSaving': 'Saving is not available',
  'session.noTravel': 'Travel is not available',
  'session.notAvailable': 'Not available',
  'session.failed': 'Something went wrong',
  'session.noEngine': 'The story engine is not connected yet.',
  'session.noAction': 'Action "{id}" is not available yet.',

  // Story results
  'story.received': 'Received: {list}',
  'story.item': '{qty}× {item}',
  'story.paid': 'Paid {coins}.',
  'story.handedOver': 'Handed over: {list}',
  'story.xp': '+{xp} XP',
  'story.tip': 'Tip: {tip}',
  'story.adventureEnds': 'The adventure ends.',
  'story.inFight': 'You are in the middle of a fight!',
  'story.fightStillOn': 'The fight is still on!',
  'story.youAreIn': 'You are in {name}. {summary}',
  'story.cantAfford': "You can't afford that ({coins} needed).",

  // Companions
  'companion.waits': '{name} will wait for you.',
  'companion.leaves': '{name} leaves the party.',
  'companion.betrayed': '{name} has betrayed you!',
  'companion.dead': '{name} is dead.',
  'companion.controlPlayer': '{name} is now controlled by you in combat.',
  'companion.controlAi': '{name} is now controlled by the AI in combat.',
  'companion.controlOutsideCombat': 'Change control outside of combat.',

  // Combat (story side)
  'fight.start': 'Combat! {name} attack.',
  'fight.enemies': 'Enemies',
  'fight.heroFallen': '{name} has fallen. The world goes on without them…',
  'fight.victory': 'Victory! +{xp} XP',
  'fight.escaped': 'You escape the fight.',
  'fight.defeat': 'Defeat…',
  'fight.canLevelUp': 'You have enough experience to level up!',
  'fight.needsSrd': 'Combat needs the SRD data',
  'fight.none': 'There is no fight going on.',
  'fight.noEscape': 'There is no escape from this fight!',

  // Level up
  'level.up': 'Level {level}! +{hp} HP.',
  'level.upNew': 'Level {level}! +{hp} HP. New: {features}.',
  'level.needsSrd': 'Leveling needs the SRD data',
  'level.finishFight': 'Finish the fight first.',

  // Side quests
  'job.take': 'Take a job from {source}: {name}',
  'job.look': 'Look for work',
  'job.complete': 'Job complete: {name}.',
  'job.over': 'Job over: {name}.',
  'job.noneHere': 'No work is offered here.',
  'job.askAround': 'You ask around for work. {offers}',
  'job.offer': 'From {source}: "{summary}"',
  'job.nobody': 'You ask around, but nobody has work for you today.',
  'job.tryLater': 'Try again another day.',
  'job.roadOffer': 'A traveler you met on the road asks for help: {name}.',

  // Travel
  'travel.inFight': 'You cannot travel in the middle of a fight!',
  'travel.noMap': 'Travel needs the world map',
  'travel.unknown': 'Unknown place',
  'travel.cannot': 'You cannot travel there.',
  'travel.encounter': 'Travel encounter! (Tactical combat arrives in a later build; you fight them off.)',
  'travel.done': 'You travel to {name}.',
  'travel.doneDays.one': 'You travel to {name} ({count} day).',
  'travel.doneDays.other': 'You travel to {name} ({count} days).',
  'travel.arrive': 'You arrive at {name}. {summary}',

  // Equipment, repairs, shops
  'equip.needsSrd': 'Equipment needs the SRD data',
  'repair.needsSrd': 'Repairs need the SRD data',
  'repair.inFight': 'Not in the middle of a fight!',
  'repair.noSmith': 'There is no smith here.',
  'repair.done': '{text} ({coins})',
  'shop.unavailable': 'Shops are not available',
  'shop.notHere': 'That shop is not here.',
  'shop.bought': 'Bought {qty}× {item} for {coins}.',
  'shop.sold': 'Sold {qty}× {item} for {coins}.',
  'shop.item': 'item',
  'shop.haggleWon': '{shop}: the shopkeeper grudgingly offers better prices today.',
  'shop.haggleLost': '{shop}: the shopkeeper will not budge.',
} as const;

export type EngineKey = keyof typeof en;
