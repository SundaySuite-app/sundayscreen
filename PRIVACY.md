# Personvern i SundayScreen

Kort versjon: **alt bor på din maskin.**

- Klasselister (elevnavn), skjermoppsett og innstillinger lagres KUN lokalt,
  i en SQLite-fil under appens datamappe på maskinen.
- Samme datamappe inneholder også automatiske sikkerhetskopier
  (`sundayscreen.backup-1.sqlite`, `-2`, `-3` — de tre siste vellykkede
  oppstartene) og, om en database noensinne har blitt funnet ødelagt og
  gjenskapt, de gamle filene under et `.corrupt-<tidsstempel>`-navn. Dette
  er fortsatt bare filer på DIN maskin — ingen av dem sendes noe sted.
- Merker du en elev som borte, husker appen kun DAGENS dato på den eleven, og
  overskriver den neste gang. Det bygges aldri opp en fraværshistorikk — appen
  vet hvem som er her akkurat i dag, og ingenting om i går. Fraværsføring hører
  hjemme i skolens eget system.
- Appen sender ingen telemetri, ingen analyser, ingen krasjrapporter.
- Det eneste nettkallet appen noensinne gjør, er å spørre
  `updates.sundaysuite.app` om det finnes en ny versjon. Kallet inneholder
  ingen persondata, og uten nett feiler det stille — appen fungerer helt
  likt.
- Ingen konto, ingen innlogging, ingen sky.

Sletter du appens datamappe, er alt borte. Det finnes ingen kopi hos oss.
