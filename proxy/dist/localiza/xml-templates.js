"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildVehAvailRateXML = buildVehAvailRateXML;
exports.buildVehResXML = buildVehResXML;
function buildVehAvailRateXML(params) {
    return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <OTA_VehAvailRateRQ xmlns="http://www.opentravel.org/OTA/2003/05"
      EchoToken="${params.token}">
      <POS>
        <Source>
          <RequestorID Type="5" ID="${params.requestorId}" />
        </Source>
      </POS>
      <VehAvailRQCore>
        <VehRentalCore>
          <PickUpLocation LocationCode="${params.pickupLocation}" />
          <ReturnLocation LocationCode="${params.returnLocation}" />
          <PickUpDateTime>${params.pickupDateTime}</PickUpDateTime>
          <ReturnDateTime>${params.returnDateTime}</ReturnDateTime>
        </VehRentalCore>
      </VehAvailRQCore>
    </OTA_VehAvailRateRQ>
  </soap:Body>
</soap:Envelope>`;
}
function buildVehResXML(params) {
    return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <OTA_VehResRQ xmlns="http://www.opentravel.org/OTA/2003/05"
      EchoToken="${params.token}">
      <POS>
        <Source>
          <RequestorID Type="5" ID="${params.requestorId}" />
        </Source>
      </POS>
      <VehResRQCore>
        <Customer>
          <Primary>
            <PersonName>
              <Surname>${params.customerName}</Surname>
            </PersonName>
            <Email>${params.customerEmail}</Email>
            <Telephone PhoneUseType="5" PhoneTechType="5"
              CountryAccessCode="${params.customerPhoneCountryCode}"
              PhoneNumber="${params.customerPhone}" />
            <Document DocumentType="${params.customerDocumentType}"
              DocID="${params.customerDocument}" />
          </Primary>
        </Customer>
        <UniqueID Type="41" ID="${params.referenceToken}" />
        <VehRentalCore>
          <PickUpLocation LocationCode="${params.pickupLocation}" />
          <ReturnLocation LocationCode="${params.returnLocation}" />
          <PickUpDateTime>${params.pickupDateTime}</PickUpDateTime>
          <ReturnDateTime>${params.returnDateTime}</ReturnDateTime>
        </VehRentalCore>
        <RateQualifier RateQualifier="${params.rateQualifier}" />
        <VehPref Code="${params.categoryCode}" />
        <VehResRQInfo>
          <RentalPaymentPref>
            <PaymentType>3</PaymentType>
          </RentalPaymentPref>
        </VehResRQInfo>
      </VehResRQCore>
    </OTA_VehResRQ>
  </soap:Body>
</soap:Envelope>`;
}
