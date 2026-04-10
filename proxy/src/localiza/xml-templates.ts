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

export function buildVehAvailRateXML(params: AvailabilityParams): string {
  // XML structure matches Localiza legacy Laravel integration exactly
  return `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xmlns:xsd="http://www.w3.org/2001/XMLSchema">
    <OTA_VehAvailRate
      xmlns="http://tempuri.org/">
      <OTA_VehAvailRateRQ PrimaryLangID="esp"
        RetransmissionIndicator="false" TransactionStatusCode="Start" Version="0"
        TimeStamp="0001-01-01T00:00:00" EchoToken="${params.token}"
        MaxPerVendorInd="false">
        <POS>
          <Source ISOCountry="CO">
            <RequestorID
              ID="${params.requestorId}" Type="5" xmlns="http://www.opentravel.org/OTA/2003/05" />
          </Source>
        </POS>
        <VehAvailRQCore>
          <VehRentalCore PickUpDateTime="${params.pickupDateTime}"
            ReturnDateTime="${params.returnDateTime}"
            xmlns="http://www.opentravel.org/OTA/2003/05">
            <PickUpLocation
              LocationCode="${params.pickupLocation}" CodeContext="internal code" />
            <ReturnLocation
              LocationCode="${params.returnLocation}" CodeContext="internal code" />
          </VehRentalCore>
          <Customer
            xmlns="http://www.opentravel.org/OTA/2003/05">
            <Primary>
              <CitizenCountryName
                Code="CO" />
            </Primary>
          </Customer>
        </VehAvailRQCore>
      </OTA_VehAvailRateRQ>
    </OTA_VehAvailRate>
  </s:Body>
</s:Envelope>`;
}

export function buildVehRetResXML(token: string, reservationCode: string): string {
  return `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xmlns:xsd="http://www.w3.org/2001/XMLSchema">
    <OTA_VehRetRes xmlns="http://tempuri.org/">
      <OTA_VehRetResRQ EchoToken="${token}">
        <VehRetResRQCore>
          <UniqueID Type="14" ID="${reservationCode}"
            xmlns="http://www.opentravel.org/OTA/2003/05" />
        </VehRetResRQCore>
      </OTA_VehRetResRQ>
    </OTA_VehRetRes>
  </s:Body>
</s:Envelope>`;
}

export function buildVehResXML(params: ReservationParams): string {
  // XML structure matches Localiza legacy Laravel integration exactly
  return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/" xmlns:ns="http://www.opentravel.org/OTA/2003/05">
  <soapenv:Body>
    <tem:OTA_VehRes xmlns="http://tempuri.org/">
      <tem:OTA_VehResRQ xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" EchoToken="${params.token}" Target="Test" PrimaryLangID="por">
        <tem:POS>
          <tem:Source ISOCountry="CO">
            <ns:RequestorID xmlns="http://www.opentravel.org/OTA/2003/05" ID="${params.requestorId}" Type="5"/>
          </tem:Source>
        </tem:POS>
        <tem:VehResRQCore xmlns="http://tempuri.org/">
          <ns:VehRentalCore xmlns="http://www.opentravel.org/OTA/2003/05" ReturnDateTime="${params.returnDateTime}" PickUpDateTime="${params.pickupDateTime}">
            <ns:PickUpLocation LocationCode="${params.pickupLocation}" CodeContext="internal code"/>
            <ns:ReturnLocation LocationCode="${params.returnLocation}" CodeContext="internal code"/>
          </ns:VehRentalCore>
          <ns:Customer>
            <ns:Primary>
              <ns:PersonName>
                <ns:Surname>${params.customerName}</ns:Surname>
              </ns:PersonName>
              <ns:Email>${params.customerEmail}</ns:Email>
              <ns:CitizenCountryName Code="CO"/>
              <ns:Telephone CountryCode="${params.customerPhoneCountryCode}" PhoneNumber="${params.customerPhone}"/>
            </ns:Primary>
          </ns:Customer>
          <ns:VehPref CodeContext="internal code" Code="${params.categoryCode}"/>
          <ns:RateQualifier RateQualifier="${params.rateQualifier}"/>
        </tem:VehResRQCore>
        <tem:VehResRQInfo>
          <ns:RentalPaymentPref PaymentType="2">
            <ns:Voucher ValueType="2"/>
          </ns:RentalPaymentPref>
          <ns:Reference Type="41" ID="${params.referenceToken}"/>
        </tem:VehResRQInfo>
      </tem:OTA_VehResRQ>
    </tem:OTA_VehRes>
  </soapenv:Body>
</soapenv:Envelope>`;
}
