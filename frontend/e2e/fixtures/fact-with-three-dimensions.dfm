fact Measurement { value; };
dimension dim1 {
  dim1 - dim1Level1 - dim1Level2;
  dim1 - {descriptive} dim1Name;
};
dimension dim2 {
  dim2 - dim2Level1 - dim2Level2;
  dim2 - {descriptive} dim2Name;
};
dimension dim3 {
  dim3 - dim3Level1 - dim3Level2;
  dim3 - {descriptive} dim3Name;
};
Measurement - dim1;
Measurement - dim2;
Measurement - dim3;
