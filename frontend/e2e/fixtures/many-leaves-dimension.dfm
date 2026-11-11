fact Visits {
  duration;
};

dimension Place {
  place = region - country - continent;
  place - {descriptive} zipcode;
  place - {descriptive} population;
  place - {descriptive} mayor;
  place - {descriptive} area;
  place - district - zone;
};

Visits - Place;
