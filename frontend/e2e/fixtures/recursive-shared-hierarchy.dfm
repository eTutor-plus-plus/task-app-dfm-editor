fact Sales { profit; };
hierarchy employee {
  employee -[supervisor]-> employee;
  employee - region;
};
dimension employee { {shared} employee; };
Sales - employee;
