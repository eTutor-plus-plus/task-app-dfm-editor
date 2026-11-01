fact Bestellung { Menge; {descriptive} Händler; };
dimension Kunde {
  Kunde - Stadt - Land;
  Kunde - {descriptive} Größe;
};
Bestellung - Kunde;
