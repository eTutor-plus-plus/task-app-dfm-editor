fact InternationalShipmentTransaction {
  totalShippingCostInEuroCents;
  numberOfHandledContainers;
  {descriptive} responsibleLogisticsCoordinator;
};
dimension destinationInformation {
  destinationHarbourTerminal - destinationMetropolitanArea - destinationFederalState - destinationCountryRegion;
  destinationHarbourTerminal - {descriptive} terminalOperatingCompanyName;
};
InternationalShipmentTransaction - destinationInformation;
