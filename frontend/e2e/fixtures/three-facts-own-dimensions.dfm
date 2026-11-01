fact Orders { orderTotal; };
fact Shipments { weight; cost; };
fact Complaints { severity; };
dimension customer { customer - city - country; customer - segment; };
dimension carrier { carrier - region; };
dimension topic { topic - area; };
Orders - customer;
Shipments - carrier;
Complaints - topic;
