fact Invoice {
  Quantity;
  Net_Value;
  First_Commercial_Discount;
  Second_Commercial_Discount;
  Sell_In_Margin;
  Net_Average_Price;
};
// Gemeinsame Kundenhierarchie für Versand- und Rechnungsadresse
hierarchy Customer {
  Customer - City - (County) - (State) - Country - Area;
  Customer - {descriptive} address;
};
dimension Customer {
  {shared} Customer;
};
dimension Date {
  Date - Week;
  Date - Month_In_Year - Month;
  Date - Month_In_Year - Quarter - Semester -> Year;
  Date - Month_In_Year - 4_Month_Period -> Year;
};
dimension SKU {
  SKU - Made_In;
  SKU - Color - Macro_Color;
  SKU - Size;
  SKU - Subtype - Type - Category;
  SKU - Subtype - Customer_Type - {descriptive} Age_Range;
  SKU - Customer_Gender;
  SKU - Brand - Brand_Group;
};
dimension Agent {
  Agent = Controller;
  Agent - Area_Manager;
};
dimension Currency {
  Currency;
};
dimension Return_Justification {
  Return_Justification;
};
dimension Goods_On_Delivery {
  Goods_On_Delivery;
};
dimension Season {
  Season;
};
dimension Doc_Type {
  Doc_Type;
};
dimension Virtual_Warehouse {
  Virtual_Warehouse;
};
dimension Profit_Center {
  Profit_Center;
};
Invoice - Date;
Invoice -[shipping]- Customer;
Invoice -[billing]- Customer;
Invoice - SKU;
Invoice - Agent;
Invoice - Currency;
Invoice (-) Return_Justification;
Invoice (-) Goods_On_Delivery;
Invoice - Season;
Invoice (-) Doc_Type;
Invoice (-) Virtual_Warehouse;
Invoice (-) Profit_Center;
