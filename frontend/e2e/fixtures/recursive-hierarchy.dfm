fact Sales { profit; };
dimension SalesRepresentative {
  salesRepresentative -[supervisor]-> salesRepresentative;
  salesRepresentative - region;
};
Sales - SalesRepresentative;
