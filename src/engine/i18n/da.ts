/** Danish engine messages (dansk). Missing keys fall back to English; a test keeps the catalog complete. Terms: data/i18n/da/glossary.md. */
import type { EngineKey } from './en';

export const da: Partial<Record<EngineKey, string>> = {
  // Mønter
  'coins.gp': '{n} gm',
  'coins.sp': '{n} sm',
  'coins.cp': '{n} km',

  // Session
  'session.noGame': 'Der kører intet spil',
  'session.noSaving': 'Du kan ikke gemme her',
  'session.noTravel': 'Rejser er ikke mulige',
  'session.notAvailable': 'Ikke muligt',
  'session.failed': 'Noget gik galt',
  'session.noEngine': 'Historiemotoren er ikke tilsluttet endnu.',
  'session.noAction': 'Handlingen "{id}" findes ikke endnu.',

  // Historien
  'story.received': 'Modtaget: {list}',
  'story.item': '{qty}× {item}',
  'story.paid': 'Betalt: {coins}.',
  'story.handedOver': 'Afleveret: {list}',
  'story.xp': '+{xp} XP',
  'story.tip': 'Tip: {tip}',
  'story.adventureEnds': 'Eventyret slutter.',
  'story.inFight': 'Du er midt i en kamp!',
  'story.fightStillOn': 'Kampen er stadig i gang!',
  'story.youAreIn': 'Du er i {name}. {summary}',
  'story.cantAfford': 'Det har du ikke råd til ({coins} kræves).',

  // Følgesvende
  'companion.waits': '{name} venter på dig.',
  'companion.leaves': '{name} forlader gruppen.',
  'companion.betrayed': '{name} har forrådt dig!',
  'companion.dead': '{name} er død.',
  'companion.controlPlayer': 'Du styrer nu {name} i kamp.',
  'companion.controlAi': 'AI’en styrer nu {name} i kamp.',
  'companion.controlOutsideCombat': 'Skift styring uden for kamp.',

  // Kamp (historiesiden)
  'fight.start': 'Kamp! {name} angriber.',
  'fight.enemies': 'Fjender',
  'fight.heroFallen': '{name} er faldet. Verden går videre uden dem …',
  'fight.victory': 'Sejr! +{xp} XP',
  'fight.escaped': 'Du slipper væk fra kampen.',
  'fight.defeat': 'Nederlag …',
  'fight.canLevelUp': 'Du har erfaring nok til at stige et niveau!',
  'fight.needsSrd': 'Kamp kræver SRD-data',
  'fight.none': 'Der er ingen kamp i gang.',
  'fight.noEscape': 'Der er ingen flugt fra denne kamp!',

  // Niveaustigning
  'level.up': 'Niveau {level}! +{hp} LP.',
  'level.upNew': 'Niveau {level}! +{hp} LP. Nyt: {features}.',
  'level.needsSrd': 'Niveaustigning kræver SRD-data',
  'level.finishFight': 'Gør kampen færdig først.',

  // Sideopgaver
  'job.take': 'Tag et job fra {source}: {name}',
  'job.look': 'Spørg efter arbejde',
  'job.complete': 'Job fuldført: {name}.',
  'job.over': 'Job slut: {name}.',
  'job.noneHere': 'Her er intet arbejde at få.',
  'job.askAround': 'Du spørger rundt efter arbejde. {offers}',
  'job.offer': 'Fra {source}: "{summary}"',
  'job.nobody': 'Du spørger rundt, men ingen har arbejde til dig i dag.',
  'job.tryLater': 'Prøv igen en anden dag.',
  'job.roadOffer': 'En rejsende, du mødte på vejen, beder om hjælp: {name}.',

  // Rejser
  'travel.inFight': 'Du kan ikke rejse midt i en kamp!',
  'travel.noMap': 'Rejser kræver verdenskortet',
  'travel.unknown': 'Ukendt sted',
  'travel.cannot': 'Du kan ikke rejse dertil.',
  'travel.encounter': 'Møde på rejsen! (Taktisk kamp kommer i en senere udgave; du slår dem tilbage.)',
  'travel.done': 'Du rejser til {name}.',
  'travel.doneDays.one': 'Du rejser til {name} ({count} dag).',
  'travel.doneDays.other': 'Du rejser til {name} ({count} dage).',
  'travel.arrive': 'Du ankommer til {name}. {summary}',

  // Udstyr, reparationer, butikker
  'equip.needsSrd': 'Udstyr kræver SRD-data',
  'repair.needsSrd': 'Reparationer kræver SRD-data',
  'repair.inFight': 'Ikke midt i en kamp!',
  'repair.noSmith': 'Der er ingen smed her.',
  'repair.done': '{text} ({coins})',
  'shop.unavailable': 'Butikker er ikke tilgængelige',
  'shop.notHere': 'Den butik ligger ikke her.',
  'shop.bought': 'Købt {qty}× {item} for {coins}.',
  'shop.sold': 'Solgt {qty}× {item} for {coins}.',
  'shop.item': 'genstand',
  'shop.haggleWon': '{shop}: købmanden giver modvilligt bedre priser i dag.',
  'shop.haggleLost': '{shop}: købmanden vil ikke rokke sig.',
};
