interface AvailabilityParams {
    token: string;
    requestorId: string;
    pickupLocation: string;
    returnLocation: string;
    pickupDateTime: string;
    returnDateTime: string;
}
interface ReservationParams {
    token: string;
    requestorId: string;
    pickupLocation: string;
    returnLocation: string;
    pickupDateTime: string;
    returnDateTime: string;
    categoryCode: string;
    referenceToken: string;
    rateQualifier: string;
    customerName: string;
    customerEmail: string;
    customerPhone: string;
    customerPhoneCountryCode: string;
    customerDocument: string;
    customerDocumentType: string;
}
export declare function buildVehAvailRateXML(params: AvailabilityParams): string;
export declare function buildVehResXML(params: ReservationParams): string;
export {};
